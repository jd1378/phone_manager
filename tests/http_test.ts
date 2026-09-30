import { assert, assertEquals } from "@std/assert";
import { FsDirectoryBrowser } from "../src/data/fs/directory_browser.ts";
import { JsonSettingsStore } from "../src/data/fs/json_settings.ts";
import type { AppAction } from "../src/domain/models.ts";
import type { LogSource, UploadStore } from "../src/domain/ports.ts";
import { AppCatalog } from "../src/domain/use_cases/app_catalog.ts";
import { BloatwareHints } from "../src/domain/use_cases/bloatware_hints.ts";
import { Security } from "../src/presentation/http/security.ts";
import { createApp } from "../src/presentation/http/server.ts";
import { fakeDebloatSource, fakeDevices, fakePackages, MemoryLibrary, summary } from "./fakes.ts";

const PORT = 4321;
const ORIGIN = `http://127.0.0.1:${PORT}`;

function setup() {
  const actions: [string, AppAction][] = [];
  const packages = fakePackages({
    list: () => Promise.resolve([summary("com.a")]),
    act: (_s, name, _u, action) => {
      actions.push([name, action]);
      return Promise.resolve();
    },
  });
  const security = new Security(PORT);
  const settings = new JsonSettingsStore("/nonexistent/settings.json", {
    backupDirectory: "/tmp/b",
    autoLoadMetadata: false,
    bloatwareHints: false,
  });
  const app = createApp(
    {
      devices: fakeDevices(),
      packages,
      logs: {} as LogSource,
      library: new MemoryLibrary(),
      settings,
      uploads: {} as UploadStore,
      directories: new FsDirectoryBrowser("/tmp"),
      catalog: new AppCatalog(packages),
      hints: new BloatwareHints(fakeDebloatSource(), settings),
      adbVersion: "test",
    },
    security,
    new URL("file:///nonexistent/"),
  );
  const cookie = `pm_session=${security.token}`;
  const call = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
    app.fetch(
      new Request(`${ORIGIN}${path}`, { ...init, headers: { host: `127.0.0.1:${PORT}`, ...init.headers } }),
    );
  return { app, security, cookie, call, actions };
}

Deno.test("requests need our Host, our Origin and the session cookie", async () => {
  const { call, cookie } = setup();
  assertEquals((await call("/api/devices/S1/apps")).status, 401);
  assertEquals((await call("/api/devices/S1/apps", { headers: { cookie: "pm_session=wrong" } })).status, 401);
  assertEquals((await call("/api/devices/S1/apps", { headers: { cookie, host: "evil.test" } })).status, 421);
  const crossSite = await call("/api/devices/S1/apps/com.a/action", {
    method: "POST",
    headers: { cookie, origin: "https://evil.test", "content-type": "application/json" },
    body: JSON.stringify({ action: "uninstall", user: 0 }),
  });
  assertEquals(crossSite.status, 401);
  const ok = await call("/api/devices/S1/apps?user=0", { headers: { cookie } });
  assertEquals(ok.status, 200);
  assertEquals((await ok.json()).apps.length, 1);
  assert(ok.headers.get("content-security-policy")?.includes("default-src 'self'"));
});

Deno.test("login exchanges the token for an HttpOnly SameSite cookie", async () => {
  const { call, security } = setup();
  assertEquals((await call("/login?token=nope")).status, 403);
  const response = await call(`/login?token=${security.token}`);
  assertEquals(response.status, 303);
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert(setCookie.includes("HttpOnly") && setCookie.includes("SameSite=Strict"));
});

Deno.test("actions validate input before reaching the device", async () => {
  const { call, cookie, actions } = setup();
  const post = (path: string, body: unknown, contentType = "application/json") =>
    call(path, {
      method: "POST",
      headers: { cookie, origin: ORIGIN, "content-type": contentType },
      body: JSON.stringify(body),
    });
  assertEquals((await post("/api/devices/S1/apps/com.a/action", { action: "reboot", user: 0 })).status, 400);
  assertEquals(
    (await post("/api/devices/S1/apps/com.a;id/action", { action: "launch", user: 0 })).status,
    400,
  );
  assertEquals((await post("/api/devices/S1/apps/com.a/action", { action: "launch", user: -1 })).status, 400);
  assertEquals(
    (await post("/api/devices/S1/apps/com.a/action", { action: "launch", user: 0 }, "text/plain")).status,
    400,
  );
  assertEquals(
    (await post("/api/devices/S1/apps/com.a/action", { action: "force-stop", user: 0 })).status,
    200,
  );
  assertEquals(actions, [["com.a", "force-stop"]]);
});

Deno.test("malformed or hostile serials are rejected", async () => {
  const { call, cookie } = setup();
  assertEquals((await call("/api/devices/%E0%A4%A/apps", { headers: { cookie } })).status, 400);
  assertEquals((await call("/api/devices/-s/apps", { headers: { cookie } })).status, 400);
  assertEquals((await call("/api/devices/192.168.1.2%3A5555/apps", { headers: { cookie } })).status, 200);
});
