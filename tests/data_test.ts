import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { wirelessError } from "../src/data/adb/adb_devices.ts";
import {
  parseDevices,
  parseDf,
  parseHelperInfo,
  parseHelperList,
  parseLogcatLine,
  parseMdnsServices,
  parsePackageList,
  parseProcessIds,
  parseUsers,
} from "../src/data/adb/parsers.ts";
import { adbCandidates, assertCommandSucceeded } from "../src/data/adb/adb.ts";
import { bundleApkEntries, extractBundle, readApkManifest } from "../src/data/apk/apk_reader.ts";
import { FsBackupLibrary } from "../src/data/fs/fs_library.ts";
import { JsonSettingsStore } from "../src/data/fs/json_settings.ts";
import { AppError } from "../src/domain/errors.ts";

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname;

Deno.test("adb devices -l: states, models, wireless, no-permissions text", () => {
  const devices = parseDevices(`List of devices attached
AFAM0264               device usb:1-8 product:VKJ-NX9 model:VKJ_NX9 device:HNVKJX transport_id:4
emulator-5554          unauthorized transport_id:2
192.168.1.20:41235     offline product:shiba model:Pixel_8 transport_id:5
0123456789ABCDEF       no permissions (missing udev rules? user is in the plugdev group); see [http://developer.android.com/tools/device.html] usb:1-3 transport_id:3
`);
  assertEquals(devices.map((d) => [d.serial, d.state, d.model, d.wireless]), [
    ["AFAM0264", "device", "VKJ NX9", false],
    ["emulator-5554", "unauthorized", null, false],
    ["192.168.1.20:41235", "offline", "Pixel 8", true],
    ["0123456789ABCDEF", "no-permissions", null, false],
  ]);
});

Deno.test("pm list packages: '=' inside paths, any field order, null installer", () => {
  const list = parsePackageList(
    `package:/data/app/~~8Q4H9D9NIx9Ay5almSt2cg==/com.whatsapp-7qj63AJ5CtcwwGeDJpCMwQ==/base.apk=com.whatsapp versionCode:263607422  installer=com.hihonor.android.clone uid:10317
package:/system/app/WallpaperBackup/WallpaperBackup.apk=com.android.wallpaperbackup versionCode:36 uid:10151  installer=null
`,
  );
  assertEquals(list[0], {
    packageName: "com.whatsapp",
    apkPath: "/data/app/~~8Q4H9D9NIx9Ay5almSt2cg==/com.whatsapp-7qj63AJ5CtcwwGeDJpCMwQ==/base.apk",
    versionCode: 263607422,
    uid: 10317,
    installer: "com.hihonor.android.clone",
  });
  assertEquals(list[1].installer, null);
  assertEquals(list[1].uid, 10151);
});

Deno.test("small parsers: users, df, logcat, ps", () => {
  assertEquals(parseUsers("Users:\n\tUserInfo{0:مالک:4c13} running\n\tUserInfo{10:Work profile:1030}\n"), [
    { id: 0, name: "مالک", running: true },
    { id: 10, name: "Work profile", running: false },
  ]);
  assertEquals(
    parseDf("Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/block/dm-56 1000 400 600 40% /data\n"),
    { totalBytes: 1024000, freeBytes: 614400 },
  );
  assertEquals(parseDf("garbage"), null);
  assertEquals(parseLogcatLine("09-30 11:22:33.123  4242  4250 E AndroidRuntime: FATAL EXCEPTION: main"), {
    time: "09-30 11:22:33.123",
    pid: 4242,
    tid: 4250,
    level: "E",
    tag: "AndroidRuntime",
    message: "FATAL EXCEPTION: main",
  });
  assertEquals(parseLogcatLine("--------- beginning of main"), null);
  assertEquals(
    parseProcessIds("  PID NAME\n  812 com.a\n  900 com.a:remote\n  901 com.ab\n", "com.a"),
    [812, 900],
  );
});

Deno.test("helper JSON: list with icon, info with permissions", () => {
  const [app] = parseHelperList(
    `{"packageName":"com.a","versionCode":3,"label":"A","versionName":"1","minSdk":24,"targetSdk":34,"splitCount":2,"launchable":true,"permissions":["p.A"],"grantedRuntimePermissions":[],"icon":"iVBORw=="}\n`,
  );
  assertEquals(app.metadata.label, "A");
  assertEquals(app.metadata.splitCount, 2);
  assert(app.icon && app.metadata.hasIcon);
  const info = parseHelperInfo(
    `{"packageName":"com.a","versionCode":3,"label":"A","uid":10001,"installer":null,"apkPaths":["/a/base.apk"],"signers":["ab"],"permissionDetails":[{"name":"p.CAMERA","granted":true,"runtime":true}]}`,
  );
  assertEquals(info.permissions, [{ name: "p.CAMERA", granted: true, runtime: true }]);
  assertEquals(info.signers, ["ab"]);
  assertThrows(() => parseHelperInfo(""));
});

Deno.test("pm/am failures printed with exit code 0 are detected", () => {
  assertCommandSucceeded("Success");
  assertCommandSucceeded("Package com.a new state: disabled-user");
  assertThrows(() => assertCommandSucceeded("Failure [DELETE_FAILED_INTERNAL_ERROR]"), AppError);
  assertThrows(
    () => assertCommandSucceeded("Error: Activity not started, unable to resolve Intent"),
    AppError,
  );
});

Deno.test("binary manifest: base, split and versionCodeMajor", async () => {
  assertEquals(await readApkManifest(fixture("base.apk")), {
    packageName: "com.example.fixture",
    versionCode: 42,
    versionName: "1.2.3",
    split: null,
    minSdk: 23,
  });
  assertEquals((await readApkManifest(fixture("split_config.xxhdpi.apk"))).split, "config.xxhdpi");
  assertEquals((await readApkManifest(fixture("major.apk"))).versionCode, 2 ** 32 + 7);
  await assertRejects(() => readApkManifest(fixture("../data_test.ts")));
});

Deno.test("bundles: bundletool splits win over standalones; extracted APKs parse", async () => {
  assertEquals(bundleApkEntries(["splits/base-master.apk", "standalones/x.apk", "toc.pb"]), [
    "splits/base-master.apk",
  ]);
  assertEquals(bundleApkEntries(["base.apk", "config.en.apk", "icon.png", "Android/obb/x.obb"]), [
    "base.apk",
    "config.en.apk",
  ]);
  const dir = await Deno.makeTempDir();
  try {
    const paths = await extractBundle(fixture("bundle.apks"), dir);
    assertEquals(paths.map((p) => p.slice(dir.length + 1)).sort(), ["base-master.apk", "base-xxhdpi.apk"]);
    const manifests = await Promise.all(paths.map(readApkManifest));
    assertEquals(manifests.map((m) => m.split).sort(), ["config.xxhdpi", null].sort());
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

const backup = {
  packageName: "com.a",
  versionCode: 5,
  versionName: "5.0",
  label: "A",
  minSdk: 21,
  targetSdk: 34,
  signers: [],
  installer: null,
  backedUpAt: "2026-09-30T00:00:00.000Z",
  source: { model: "Phone", androidVersion: "14" },
};

Deno.test("backup library: stage, commit, list, reject unsafe names, remove", async () => {
  const root = await Deno.makeTempDir();
  try {
    const library = new FsBackupLibrary(() => Promise.resolve(root));
    assertEquals(await library.list(), []);
    const staged = await library.stage("com.a", 5);
    assertThrows(() => staged.pathFor("../escape.apk"), AppError);
    assertThrows(() => staged.pathFor("notes.txt"), AppError);
    await Deno.writeTextFile(staged.pathFor("base.apk"), "hello");
    const entry = await staged.commit(backup);
    assertEquals(entry.directory, join(root, "com.a", "5"));
    assertEquals(entry.files, [{
      name: "base.apk",
      size: 5,
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    }]);
    assertEquals((await library.list()).length, 1);
    assertEquals(library.filePath(entry, "base.apk"), join(root, "com.a", "5", "base.apk"));
    assertThrows(() => library.filePath(entry, "other.apk"), AppError);

    // A second backup of the same version racing the first keeps the existing one.
    const racing = await library.stage("com.a", 5);
    await Deno.writeTextFile(racing.pathFor("base.apk"), "different");
    assertEquals((await racing.commit(backup)).files[0].size, 5);
    assertEquals([...Deno.readDirSync(join(root, "com.a"))].map((e) => e.name), ["5"]);

    await assertRejects(() => library.stage("../../etc", 1), AppError);
    await library.remove("com.a", 5);
    assertEquals(await library.list(), []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("settings: defaults, validation, persistence", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = join(dir, "config", "settings.json");
    const defaults = {
      backupDirectory: join(dir, "backups"),
      autoLoadMetadata: false,
      bloatwareHints: false,
    };
    const store = new JsonSettingsStore(path, defaults);
    assertEquals(await store.get(), defaults);
    await assertRejects(() => store.update({ backupDirectory: "relative/path" }), AppError);
    const target = join(dir, "new", "backups");
    await store.update({ backupDirectory: target, autoLoadMetadata: true, bloatwareHints: true });
    assert((await Deno.stat(target)).isDirectory);
    assertEquals(await new JsonSettingsStore(path, defaults).get(), {
      backupDirectory: target,
      autoLoadMetadata: true,
      bloatwareHints: true,
    });
    await Deno.writeTextFile(path, "{not json");
    assertEquals(await new JsonSettingsStore(path, defaults).get(), defaults);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("adb mdns services: pairing and connect entries, IPv6, junk ignored", () => {
  assertEquals(
    parseMdnsServices(`List of discovered mdns services
adb-6PO7LJKJCY4XDUGA-HmopAu	_adb-tls-connect._tcp	192.168.8.12:33083
adb-6PO7LJKJCY4XDUGA-Xk2p	_adb-tls-pairing._tcp.	192.168.8.12:37015
adb-X	_adb-tls-connect._tcp	[fe80::1%wlan0]:40001
adb-Y	_adb._tcp	192.168.8.13:5555
`),
    [
      { name: "adb-6PO7LJKJCY4XDUGA-HmopAu", kind: "connect", host: "192.168.8.12", port: 33083 },
      { name: "adb-6PO7LJKJCY4XDUGA-Xk2p", kind: "pairing", host: "192.168.8.12", port: 37015 },
      { name: "adb-X", kind: "connect", host: "fe80::1%wlan0", port: 40001 },
    ],
  );
  assertEquals(parseMdnsServices("ERROR: mdns discovery disabled"), []);
});

Deno.test("wireless errors name the likely cause and keep adb's text as detail", () => {
  const handshake = wirelessError("pair", "error: protocol fault (couldn't read status message): Success");
  assert(handshake.message.includes("'Pair device with pairing code' popup"));
  assertEquals(handshake.detail, "error: protocol fault (couldn't read status message): Success");
  assert(
    wirelessError("pair", "Failed: Wrong password or connection was dropped.").message.startsWith(
      "Wrong pairing code",
    ),
  );
  assert(
    wirelessError("connect", "failed to authenticate to 192.168.8.12:33083").message.includes("not paired"),
  );
  assert(
    wirelessError("connect", "failed to connect to '1.2.3.4:5': Connection refused").message.includes(
      "did not answer",
    ),
  );
  assertEquals(wirelessError("connect", "something new").message, "something new");
});

Deno.test("adb is looked up on PATH first, then SDK and package manager folders", () => {
  const env = (vars: Record<string, string>) => (name: string) => vars[name];
  assertEquals(adbCandidates(env({ HOME: "/home/u", ANDROID_HOME: "/opt/sdk" }), "linux"), [
    "adb",
    "/opt/sdk/platform-tools/adb",
    "/home/u/Android/Sdk/platform-tools/adb",
    "/usr/bin/adb",
    "/usr/local/bin/adb",
  ]);
  assertEquals(adbCandidates(env({ HOME: "/Users/u" }), "darwin"), [
    "adb",
    "/Users/u/Library/Android/sdk/platform-tools/adb",
    "/opt/homebrew/bin/adb",
    "/usr/local/bin/adb",
  ]);
  assertEquals(adbCandidates(env({}), "windows"), ["adb"]);
});
