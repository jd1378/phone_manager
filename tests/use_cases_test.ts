import { assert, assertEquals } from "@std/assert";
import { AppError } from "../src/domain/errors.ts";
import type { LogLine, Upload } from "../src/domain/models.ts";
import type { LogSource, UploadStore } from "../src/domain/ports.ts";
import { AppCatalog } from "../src/domain/use_cases/app_catalog.ts";
import { appLog } from "../src/domain/use_cases/app_log.ts";
import { backupApps } from "../src/domain/use_cases/backup.ts";
import { installGroups, planInstall } from "../src/domain/use_cases/install.ts";
import { details, fakeDevices, fakePackages, MemoryLibrary, metadata, summary } from "./fakes.ts";

const noProgress = () => {};

Deno.test("backup copies every split, records metadata and skips versions already saved", async () => {
  const library = new MemoryLibrary();
  const pulled: string[] = [];
  const packages = fakePackages({
    list: () => Promise.resolve([summary("com.a", { versionCode: 7 }), summary("com.b")]),
    apkPaths: (_s, name) =>
      Promise.resolve([`/data/app/x/${name}/base.apk`, `/data/app/x/${name}/split_config.en.apk`]),
    details: (_s, name) => Promise.resolve(details(name, { signers: ["cafe"] })),
    pull: (_s, remote, local) => {
      pulled.push(`${remote} -> ${local}`);
      return Promise.resolve();
    },
  });
  const deps = { devices: fakeDevices(), packages, library };
  const first = await backupApps(deps, "S1", 0, ["com.a"], noProgress);
  assertEquals(first, [{ item: "com.a", ok: true, message: "Saved 2 APKs" }]);
  assertEquals(pulled.length, 2);
  assertEquals(library.entries[0].versionCode, 7);
  assertEquals(library.entries[0].signers, ["cafe"]);
  assertEquals(library.entries[0].source.model, "Phone");

  const second = await backupApps(deps, "S1", 0, ["com.a"], noProgress);
  assertEquals(second[0].message, "Already in library");
  assertEquals(pulled.length, 2);
});

Deno.test("backup: a failing app is reported, staged files are discarded, others continue", async () => {
  const library = new MemoryLibrary();
  const packages = fakePackages({
    list: () => Promise.resolve([summary("com.bad"), summary("com.good")]),
    apkPaths: (_s, name) => Promise.resolve([`/data/app/${name}/base.apk`]),
    details: () => Promise.reject(new AppError("helper-failed", "no helper")),
    pull: (_s, remote) =>
      remote.includes("bad") ? Promise.reject(new AppError("adb-failed", "pull failed")) : Promise.resolve(),
  });
  const progress: string[] = [];
  const results = await backupApps(
    { devices: fakeDevices(), packages, library },
    "S1",
    0,
    ["com.bad", "com.missing", "com.good"],
    (p) => progress.push(p.message),
  );
  assertEquals(results.map((r) => [r.item, r.ok]), [["com.bad", false], ["com.missing", false], [
    "com.good",
    true,
  ]]);
  assertEquals(library.aborted, 1);
  assertEquals(library.entries[0].label, null, "details failure still saves the APKs");
  assertEquals(progress.at(-1), "Finished");
});

const uploadStore = (uploads: Upload[]): UploadStore => ({
  save: () => Promise.reject(new Error("unused")),
  get: (id) => uploads.find((u) => u.id === id) ?? null,
  remove: () => Promise.resolve(),
});

Deno.test("install plan: fetches signers only for installed apps coming from the library", async () => {
  const library = new MemoryLibrary();
  const staged = await library.stage("com.lib", 3);
  staged.pathFor("base.apk");
  await staged.commit({
    packageName: "com.lib",
    versionCode: 3,
    versionName: "3",
    label: "Lib",
    minSdk: 21,
    targetSdk: 34,
    signers: ["new-key"],
    installer: null,
    backedUpAt: "2026-01-01",
    source: { model: null, androidVersion: null },
  });
  const detailCalls: string[] = [];
  const packages = fakePackages({
    list: () =>
      Promise.resolve([summary("com.lib", { versionCode: 2 }), summary("com.up", { versionCode: 9 })]),
    details: (_s, name) => {
      detailCalls.push(name);
      return Promise.resolve(details(name, { signers: ["old-key"] }));
    },
  });
  const uploads = uploadStore([{
    id: "u1",
    name: "up.apk",
    size: 1,
    apks: [{
      fileName: "up.apk",
      path: "/tmp/up.apk",
      size: 1,
      manifest: { packageName: "com.up", versionCode: 4, versionName: null, split: null, minSdk: null },
    }],
  }]);
  const plan = await planInstall(
    { devices: fakeDevices(), packages, library, uploads },
    "S1",
    0,
    { uploadIds: ["u1"], library: [{ packageName: "com.lib", versionCode: 3 }] },
  );
  assertEquals(detailCalls, ["com.lib"]);
  assertEquals(plan.map((g) => [g.packageName, g.warnings.map((w) => w.kind)]), [
    ["com.up", ["downgrade"]],
    ["com.lib", ["signer-mismatch"]],
  ]);
});

Deno.test("install plan rejects expired uploads", async () => {
  const deps = {
    devices: fakeDevices(),
    packages: fakePackages(),
    library: new MemoryLibrary(),
    uploads: uploadStore([]),
  };
  let error: unknown;
  await planInstall(deps, "S1", 0, { uploadIds: ["gone"], library: [] }).catch((e) => (error = e));
  assert(error instanceof AppError && error.code === "not-found");
});

Deno.test("installGroups reports each group and keeps going", async () => {
  const calls: string[][] = [];
  const packages = fakePackages({
    install: (_s, paths) => {
      calls.push(paths);
      return Promise.resolve(
        paths[0].includes("bad")
          ? { code: "INSTALL_FAILED_OLDER_SDK", message: "too old", hint: "Needs newer Android." }
          : null,
      );
    },
  });
  const group = (name: string) => ({
    packageName: name,
    label: null,
    versionCode: 1,
    versionName: null,
    minSdk: null,
    signers: [],
    files: [{ name: "base.apk", path: `/x/${name}/base.apk`, size: 1 }],
    warnings: [],
  });
  const results = await installGroups(packages, "S1", [group("bad"), group("good")], {
    user: 0,
    grantPermissions: false,
    allowDowngrade: false,
  }, noProgress);
  assertEquals(results, [
    { item: "bad", ok: false, message: "too old. Needs newer Android." },
    { item: "good", ok: true, message: "Installed" },
  ]);
  assertEquals(calls.length, 2);
});

Deno.test("catalog attaches helper metadata only while the version code matches", async () => {
  let versionCode = 1;
  const packages = fakePackages({
    list: () => Promise.resolve([summary("com.a", { versionCode })]),
    metadata: () =>
      Promise.resolve([{
        packageName: "com.a",
        versionCode: 1,
        metadata: metadata("A"),
        icon: new Uint8Array([1]),
      }]),
    sizes: () => Promise.reject(new Error("sizes unavailable")),
  });
  const catalog = new AppCatalog(packages);
  assertEquals((await catalog.list("S1", 0))[0].metadata, null);
  const loaded = await catalog.loadMetadata("S1", 0);
  assertEquals(loaded[0].metadata?.label, "A");
  assertEquals(loaded[0].sizes, null, "size failures are not fatal");
  assert(catalog.icon("S1", "com.a"));
  versionCode = 2;
  assertEquals((await catalog.list("S1", 0))[0].metadata, null, "app updated since metadata was read");
});

Deno.test("app log keeps lines from the package's processes and lines naming it", async () => {
  const line = (pid: number, message: string): LogLine => ({
    time: "",
    pid,
    tid: pid,
    level: "I",
    tag: "T",
    message,
  });
  let refreshes = 0;
  const source: LogSource = {
    async *lines() {
      yield line(1, "mine");
      yield line(2, "someone else");
      yield line(3, "Process com.a:remote has died");
      await new Promise((r) => setTimeout(r, 30));
      yield line(4, "restarted process");
    },
    processIds: () => Promise.resolve(++refreshes === 1 ? [1] : [4]),
  };
  const seen: string[] = [];
  for await (const l of appLog(source, "S1", "com.a", new AbortController().signal, 10)) seen.push(l.message);
  assertEquals(seen, ["mine", "Process com.a:remote has died", "restarted process"]);
});
