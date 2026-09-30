import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { parseUadList, UadDebloatSource } from "../src/data/debloat/uad_list.ts";
import { DEFAULT_FILTER, queryApps } from "../src/domain/app_query.ts";
import { bloatVerdict, isRiskyToRemove, trackingMention } from "../src/domain/debloat.ts";
import type { App } from "../src/domain/models.ts";
import { AppCatalog } from "../src/domain/use_cases/app_catalog.ts";
import { BloatwareHints, REFRESH_AFTER_MS, RETRY_AFTER_MS } from "../src/domain/use_cases/bloatware_hints.ts";
import { removalWarning } from "../src/presentation/web/debloat_text.ts";
import { debloatEntry, debloatList, fakeDebloatSource, fakePackages, summary } from "./fakes.ts";
import type { Settings } from "../src/domain/models.ts";
import type { SettingsStore } from "../src/domain/ports.ts";

Deno.test("tracking mentions are judged per clause: stated, hedged or negated", () => {
  const judge = (text: string) => trackingMention(text)?.certainty ?? null;
  // Sentences taken from the UAD-ng list.
  assertEquals(judge("Useless logs, data collection."), "yes");
  assertEquals(judge("Xiaomi keyboard Have ads and analytics."), "yes");
  assertEquals(judge("TCT All in One Configuration It probably collects some data"), "maybe");
  assertEquals(judge("Seems to be a spyware"), "maybe");
  assertEquals(judge("Doesn't seem to do anything important, only tracking"), "maybe"); // hedged sentence
  assertEquals(judge("On some OEM's this app has ads, tracking things."), "maybe");
  assertEquals(judge("Preinstalled game on some Samsung phones. 30 permissions, 23 trackers"), "yes");
  // Tracking as a feature is not tracking the user.
  assertEquals(judge("UWB technology resources for location tracking."), null);
  assertEquals(judge("Samsung's Find My Mobile service for tracking your phone if you lost it."), null);
  assertEquals(judge("That's an app for device and app usage tracking and limiting."), null);
  assertEquals(judge("probably for install apps but it's useless and have ads"), "yes");
  assertEquals(judge("No activities, uses miui analytics"), "yes");
  assertEquals(judge("Screenshots without grabbing ads"), null);
  assertEquals(judge("Calculator app. Safe to remove."), null);
  assertEquals(trackingMention("Launcher. Has Firebase Analytics.")?.evidence, "Has Firebase Analytics");
});

const uadEntry = (removal: string, extra: Record<string, unknown> = {}) => ({
  list: "Oem",
  description: "Some app",
  dependencies: [],
  neededBy: [],
  labels: [],
  removal,
  ...extra,
});

/** The parser refuses tiny lists, so pad fixtures to a realistic size. */
function uadJson(entries: Record<string, unknown>): string {
  const padded: Record<string, unknown> = { ...entries };
  for (let i = 0; i < 120; i++) padded[`com.example.filler${i}`] = uadEntry("Recommended");
  return JSON.stringify(padded);
}

Deno.test("UAD list parsing maps levels, validates names and skips what it does not understand", () => {
  const entries = parseUadList(uadJson({
    "com.android.systemui": uadEntry("Unsafe", {
      list: "Aosp",
      neededBy: ["com.android.phone", "bad name!"],
    }),
    "com.facebook.services": uadEntry("Recommended", { description: "Facebook services. Has trackers." }),
    "com.vendor.weird": uadEntry("Maybe"),
    "not a package": uadEntry("Recommended"),
  }));
  assertEquals(entries.get("com.android.systemui")?.level, "unsafe");
  assertEquals(entries.get("com.android.systemui")?.category, "aosp");
  assertEquals(entries.get("com.android.systemui")?.neededBy, ["com.android.phone"]);
  assertEquals(entries.get("com.facebook.services")?.tracking?.certainty, "yes");
  assertEquals(entries.has("com.vendor.weird"), false);
  assertEquals(entries.has("not a package"), false);
  assertEquals(entries.size, 122);
});

Deno.test("UAD list parsing rejects files that are not the list", () => {
  let error: unknown;
  try {
    parseUadList(JSON.stringify({ "com.a": uadEntry("Recommended") }));
  } catch (e) {
    error = e;
  }
  assert(error instanceof Error && error.message.includes("usable entries"));
  try {
    parseUadList("[]");
  } catch (e) {
    error = e;
  }
  assert(error instanceof Error && error.message.includes("format"));
});

Deno.test("UAD source caches downloads and keeps the old copy when a download fails", async () => {
  const dir = await Deno.makeTempDir();
  try {
    let response = new Response(uadJson({ "com.a.b": uadEntry("Advanced") }));
    const source = new UadDebloatSource(
      join(dir, "cache"),
      () => Promise.resolve(response),
      "https://example.test",
    );
    assertEquals(await source.cached(), null);
    const downloaded = await source.download();
    assertEquals(downloaded.entries.get("com.a.b")?.level, "advanced");
    assertEquals((await source.cached())?.updatedAt, downloaded.updatedAt);

    response = new Response("oops", { status: 503 });
    await assertRejects(() => source.download(), Error, "HTTP 503");
    response = new Response("{broken");
    await assertRejects(() => source.download());
    assertEquals((await source.cached())?.entries.get("com.a.b")?.level, "advanced");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

class MemorySettings implements SettingsStore {
  constructor(public value: Settings) {}
  get() {
    return Promise.resolve(this.value);
  }
  update(patch: Partial<Settings>) {
    this.value = { ...this.value, ...patch };
    return Promise.resolve(this.value);
  }
}

const settingsWith = (bloatwareHints: boolean) =>
  new MemorySettings({ backupDirectory: "/b", autoLoadMetadata: false, bloatwareHints });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

Deno.test("hints are off until enabled and never block on the network", async () => {
  let downloads = 0;
  const list = debloatList({ "com.a": debloatEntry() });
  const source = fakeDebloatSource({
    download: () => {
      downloads++;
      return Promise.resolve(list);
    },
  });
  const settings = settingsWith(false);
  const hints = new BloatwareHints(source, settings);
  let notified = 0;
  hints.onUpdate(() => notified++);

  assertEquals(await hints.current(), null);
  assertEquals(downloads, 0);

  await settings.update({ bloatwareHints: true });
  assertEquals(await hints.current(), null, "first call returns at once and downloads in the background");
  await flush();
  assertEquals(downloads, 1);
  assertEquals(notified, 1);
  assertEquals((await hints.current())?.entries.size, 1);
  assertEquals(downloads, 1, "a fresh list is not downloaded again");
});

Deno.test("hints refresh a week-old list and back off after a failed download", async () => {
  let now = Date.parse("2026-01-10T00:00:00Z");
  let downloads = 0;
  let fail = true;
  const old = debloatList({ "com.a": debloatEntry() }, "2026-01-01T00:00:00Z");
  const source = fakeDebloatSource({
    cached: () => Promise.resolve(old),
    download: () => {
      downloads++;
      return fail
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(debloatList({}, new Date(now).toISOString()));
    },
  });
  const hints = new BloatwareHints(source, settingsWith(true), () => now);

  assertEquals(await hints.current(), old, "the old copy is served while refreshing");
  await flush();
  assertEquals(downloads, 1);
  assertEquals((await hints.status()).error, "offline");

  await hints.current();
  await flush();
  assertEquals(downloads, 1, "no retry within the back-off window");

  now += RETRY_AFTER_MS + 1;
  fail = false;
  await hints.current();
  await flush();
  assertEquals(downloads, 2);
  assertEquals((await hints.status()).error, null);
  assert(REFRESH_AFTER_MS > RETRY_AFTER_MS);
});

Deno.test("catalog labels only listed packages", async () => {
  const packages = fakePackages({
    list: () => Promise.resolve([summary("com.listed"), summary("com.unknown")]),
  });
  const list = debloatList({ "com.listed": debloatEntry({ level: "unsafe" }) });
  const catalog = new AppCatalog(packages, { current: () => Promise.resolve(list) });
  const apps = await catalog.list("S1", 0);
  assertEquals(apps.map((a) => a.debloat?.level ?? null), ["unsafe", null]);
});

const app = (name: string, debloat: App["debloat"]): App => ({
  ...summary(name),
  metadata: null,
  sizes: null,
  debloat,
});

Deno.test("bloatware filter selects by level, listed or tracking", () => {
  const apps = [
    app("com.bloat", debloatEntry({ level: "recommended" })),
    app("com.needed", debloatEntry({ level: "unsafe" })),
    app("com.spy", debloatEntry({ level: "advanced", tracking: { certainty: "maybe", evidence: "x" } })),
    app("com.unlisted", null),
  ];
  const names = (debloat: typeof DEFAULT_FILTER.debloat) =>
    queryApps(apps, { ...DEFAULT_FILTER, kind: "all", debloat }).map((a) => a.packageName);
  assertEquals(names("any").length, 4);
  assertEquals(names("listed"), ["com.bloat", "com.needed", "com.spy"]);
  assertEquals(names("unsafe"), ["com.needed"]);
  assertEquals(names("tracking"), ["com.spy"]);
});

Deno.test("removal warnings only for risky listed packages and removing actions", () => {
  const nameOf = (p: string) => p === "com.phone" ? "Phone" : p;
  const needed = app(
    "com.systemui",
    debloatEntry({ level: "unsafe", description: "System UI.", neededBy: ["com.phone"] }),
  );
  const warning = removalWarning(needed, "uninstall", nameOf);
  assert(warning?.includes("can break your phone"));
  assert(warning?.includes("These need it: Phone."));
  assert(warning?.includes("List notes: System UI."));
  assertEquals(removalWarning(needed, "force-stop", nameOf), null);
  assertEquals(removalWarning(app("com.bloat", debloatEntry()), "uninstall", nameOf), null);
  assertEquals(removalWarning(app("com.unlisted", null), "uninstall", nameOf), null);
  assert(
    removalWarning(app("com.maybe", debloatEntry({ level: "expert" })), "disable", nameOf)?.includes(
      "unsure",
    ),
  );
  assertEquals(
    removalWarning(app("com.maybe", debloatEntry({ level: "expert" })), "clear-data", nameOf),
    null,
  );
  assert(isRiskyToRemove(debloatEntry({ neededBy: ["com.x"] })));
  assert(!isRiskyToRemove(null));
});

Deno.test("user-installed copies of often-preinstalled apps are not called bloatware", () => {
  assertEquals(bloatVerdict(debloatEntry({ level: "recommended" }), true), "recommended");
  assertEquals(bloatVerdict(debloatEntry({ level: "recommended" }), false), "often-preinstalled");
  assertEquals(bloatVerdict(debloatEntry({ level: "advanced" }), false), "often-preinstalled");
  assertEquals(bloatVerdict(debloatEntry({ level: "unsafe" }), false), "unsafe", "risk levels stay");
  assertEquals(bloatVerdict(null, true), null);
  const userCopy = { ...app("com.whatsapp", debloatEntry({ level: "recommended" })), system: false };
  const preinstalled = {
    ...app("com.facebook.system", debloatEntry({ level: "recommended" })),
    system: true,
  };
  const pick = (debloat: typeof DEFAULT_FILTER.debloat) =>
    queryApps([userCopy, preinstalled], { ...DEFAULT_FILTER, kind: "all", debloat }).map((a) =>
      a.packageName
    );
  assertEquals(pick("recommended"), ["com.facebook.system"]);
  assertEquals(pick("often-preinstalled"), ["com.whatsapp"]);
});

Deno.test("status reports the saved list before anything asked for it", async () => {
  const saved = debloatList({ "com.a": debloatEntry() });
  const hints = new BloatwareHints(
    fakeDebloatSource({ cached: () => Promise.resolve(saved) }),
    settingsWith(true),
    () => Date.parse(saved.updatedAt),
  );
  const status = await hints.status();
  assertEquals(status.packages, 1);
  assertEquals(status.updatedAt, saved.updatedAt);
});
