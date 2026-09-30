import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import { DEFAULT_FILTER, filterOptions, queryApps } from "../src/domain/app_query.ts";
import { AppError } from "../src/domain/errors.ts";
import { appsToCsv } from "../src/domain/export.ts";
import { parseInstallOutput } from "../src/domain/install_failure.ts";
import { groupApks, libraryGroup, withWarnings } from "../src/domain/install_plan.ts";
import { groupByPackage, libraryStatus } from "../src/domain/library.ts";
import type { App, InspectedApk, LibraryEntry } from "../src/domain/models.ts";
import {
  isHost,
  isPackageName,
  isPermissionName,
  isSerial,
  isUserId,
  remoteApkFileName,
} from "../src/domain/validation.ts";
import { metadata, summary } from "./fakes.ts";

Deno.test("package names: Android's rules, nothing a shell would interpret", () => {
  for (const ok of ["android", "com.whatsapp", "org.fdroid.fdroid", "a.b_c.D9"]) {
    assert(isPackageName(ok), ok);
  }
  for (
    const bad of ["", "1com.x", "com..x", "com.x;rm -rf", "com.x y", "com.$(id)", "com.1x", ".com", "com."]
  ) {
    assertFalse(isPackageName(bad), bad);
  }
});

Deno.test("other identifiers are validated", () => {
  assert(isSerial("emulator-5554"));
  assert(isSerial("192.168.1.20:5555"));
  assert(isSerial("adb-R58M1._adb-tls-connect._tcp"));
  assertFalse(isSerial("-s"));
  assertFalse(isSerial("a b"));
  assert(isPermissionName("android.permission.CAMERA"));
  assertFalse(isPermissionName("CAMERA; reboot"));
  assert(isUserId(0) && isUserId(10));
  assertFalse(isUserId(-1) || isUserId(1.5) || isUserId("0"));
  assert(isHost("192.168.1.20") && isHost("[fe80::1%wlan0]") && isHost("phone.local"));
  assertFalse(isHost("-o") || isHost("a b"));
});

Deno.test("remote APK names cannot escape the backup folder", () => {
  assertEquals(remoteApkFileName("/data/app/~~ab==/com.a-x==/split_config.en.apk"), "split_config.en.apk");
  assertThrows(() => remoteApkFileName("/data/app/../../etc/passwd"), AppError);
  assertThrows(() => remoteApkFileName("/data/app/..apk"), AppError);
  assertThrows(() => remoteApkFileName("/data/app/x/base.so"), AppError);
});

Deno.test("install output: success, bracketed failure with hint, unknown", () => {
  assertEquals(parseInstallOutput("Performing Streamed Install\nSuccess\n"), null);
  const failure = parseInstallOutput(
    "adb: failed to install a.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package com.a signatures do not match newer version; ignoring!]",
  );
  assertEquals(failure?.code, "INSTALL_FAILED_UPDATE_INCOMPATIBLE");
  assert(failure?.message.startsWith("Existing package com.a"));
  assert(failure?.hint?.includes("Uninstall"));
  assertEquals(parseInstallOutput("adb: device offline")?.code, "UNKNOWN");
});

const app = (name: string, patch: Partial<App> = {}): App => ({
  ...summary(name),
  metadata: null,
  sizes: null,
  debloat: null,
  ...patch,
});

Deno.test("search matches label, package, installer name and permissions; all terms must match", () => {
  const apps = [
    app("com.whatsapp", { metadata: metadata("WhatsApp", { permissions: ["android.permission.CAMERA"] }) }),
    app("org.mozilla.firefox", { installer: "org.fdroid.fdroid", metadata: metadata("Firefox") }),
    app("com.example.plain", { installer: null }),
  ];
  const search = (query: string) =>
    queryApps(apps, { ...DEFAULT_FILTER, kind: "all", query }).map((a) => a.packageName);
  assertEquals(search("whats"), ["com.whatsapp"]);
  assertEquals(search("CAMERA"), ["com.whatsapp"]);
  assertEquals(search("f-droid"), ["org.mozilla.firefox"]);
  assertEquals(search("mozilla fire"), ["org.mozilla.firefox"]);
  assertEquals(search("mozilla whats"), []);
  assertEquals(search("plain"), ["com.example.plain"]);
});

Deno.test("filters: kind, state, installer, metadata-only filters exclude apps without metadata", () => {
  const apps = [
    app("a.user"),
    app("b.system", { system: true, metadata: metadata("B", { updatedSystem: true }) }),
    app("c.disabled", { enabled: false }),
    app("d.gone", { installed: false }),
    app("e.debug", { installer: null, metadata: metadata("E", { debuggable: true }) }),
  ];
  const names = (patch: Partial<typeof DEFAULT_FILTER>) =>
    queryApps(apps, { ...DEFAULT_FILTER, kind: "all", ...patch }).map((a) => a.packageName);
  assertEquals(names({ kind: "user" }), ["a.user", "c.disabled", "d.gone", "e.debug"]);
  assertEquals(names({ kind: "updated-system" }), ["b.system"]);
  assertEquals(names({ state: "disabled" }), ["c.disabled"]);
  assertEquals(names({ state: "not-installed" }), ["d.gone"]);
  assertEquals(names({ installer: "" }), ["e.debug"]);
  assertEquals(names({ debuggable: "yes" }), ["e.debug"]);
  assertEquals(names({ debuggable: "no" }), ["b.system"]);
});

Deno.test("sorting keeps apps without the value last in both directions", () => {
  const apps = [
    app("a", { metadata: metadata("A", { lastUpdateTime: 10 }) }),
    app("b"),
    app("c", { metadata: metadata("C", { lastUpdateTime: 30 }) }),
  ];
  const order = (descending: boolean) =>
    queryApps(apps, { ...DEFAULT_FILTER, kind: "all", sort: "updated", descending }).map((a) =>
      a.packageName
    );
  assertEquals(order(false), ["a", "c", "b"]);
  assertEquals(order(true), ["c", "a", "b"]);
});

Deno.test("filter options list installers and granted permissions", () => {
  const options = filterOptions([
    app("a", {
      installer: "com.android.vending",
      metadata: metadata("A", { grantedRuntimePermissions: ["p.X"] }),
    }),
    app("b", { installer: null }),
  ]);
  assertEquals(options.installers.length, 2);
  assertEquals(options.permissions, ["p.X"]);
});

Deno.test("CSV export quotes and neutralizes formulas", () => {
  const csv = appsToCsv([app("com.a", { metadata: metadata('=HYPERLINK("x"), "q"') })]);
  const row = csv.split("\r\n")[1];
  assert(row.startsWith('com.a,"\'=HYPERLINK(""x""), ""q"""'), row);
});

const apk = (
  fileName: string,
  packageName: string | null,
  split: string | null = null,
  versionCode = 5,
): InspectedApk => ({
  fileName,
  path: `/tmp/${fileName}`,
  size: 10,
  manifest: packageName ? { packageName, versionCode, versionName: "5.0", split, minSdk: 26 } : null,
});

Deno.test("loose APKs group per package and version, base first; unreadable ones stand alone", () => {
  const groups = groupApks([
    apk("split_en.apk", "com.a", "config.en"),
    apk("base.apk", "com.a"),
    apk("other.apk", "com.b"),
    apk("broken.apk", null),
    apk("lonely_split.apk", "com.c", "config.xxhdpi"),
  ]);
  assertEquals(groups.map((g) => g.packageName), ["com.a", "com.b", "com.c", null]);
  assertEquals(groups[0].files.map((f) => f.name), ["base.apk", "split_en.apk"]);
  assertEquals(groups[0].minSdk, 26);
  assertEquals(groups[2].warnings, [{ kind: "missing-base" }]);
  assertEquals(groups[3].warnings, [{ kind: "unreadable", fileName: "broken.apk" }]);
});

Deno.test("warnings compare against the device", () => {
  const [group] = groupApks([apk("base.apk", "com.a", null, 5)]);
  const warn = (
    installed: [string, { versionCode: number; signers: string[] }][],
    sdk = 34,
    signers: string[] = [],
  ) =>
    withWarnings({ ...group, signers }, { sdk, installed: new Map(installed) }).warnings.map((w) => w.kind);
  assertEquals(warn([]), []);
  assertEquals(warn([], 25), ["min-sdk"]);
  assertEquals(warn([["com.a", { versionCode: 9, signers: [] }]]), ["downgrade"]);
  assertEquals(warn([["com.a", { versionCode: 5, signers: [] }]]), ["reinstall"]);
  assertEquals(warn([["com.a", { versionCode: 1, signers: ["x"] }]], 34, ["y"]), ["signer-mismatch"]);
  assertEquals(warn([["com.a", { versionCode: 1, signers: ["x"] }]], 34, ["x"]), []);
});

const entry = (packageName: string, versionCode: number, backedUpAt: string): LibraryEntry => ({
  formatVersion: 1,
  packageName,
  versionCode,
  versionName: null,
  label: null,
  minSdk: null,
  targetSdk: null,
  signers: [],
  installer: null,
  files: [{ name: "split_config.en.apk", size: 1, sha256: "" }, { name: "base.apk", size: 2, sha256: "" }],
  backedUpAt,
  source: { model: null, androidVersion: null },
  directory: `/b/${packageName}/${versionCode}`,
});

Deno.test("library groups by package, newest version first, most recent backup first", () => {
  const groups = groupByPackage([
    entry("com.a", 1, "2026-01-01"),
    entry("com.b", 3, "2026-03-01"),
    entry("com.a", 2, "2026-02-01"),
  ]);
  assertEquals(groups.map((g) => g.map((e) => `${e.packageName}@${e.versionCode}`)), [
    ["com.b@3"],
    ["com.a@2", "com.a@1"],
  ]);
  const installed = new Map([["com.a", 2]]);
  assertEquals(libraryStatus(entry("com.a", 3, ""), installed), "newer-in-library");
  assertEquals(libraryStatus(entry("com.a", 2, ""), installed), "installed");
  assertEquals(libraryStatus(entry("com.a", 1, ""), installed), "older-in-library");
  assertEquals(libraryStatus(entry("com.z", 1, ""), installed), "not-installed");
  assertEquals(libraryGroup(entry("com.a", 1, ""), (n) => n).files.map((f) => f.name), [
    "base.apk",
    "split_config.en.apk",
  ]);
});
