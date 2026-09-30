import { extname, fromFileUrl } from "@std/path";
import { AppError } from "../../domain/errors.ts";
import type { InstallGroup } from "../../domain/install_plan.ts";
import type { AppAction, LogLine, Upload } from "../../domain/models.ts";
import type {
  BackupLibrary,
  DeviceRegistry,
  DirectoryBrowser,
  LogSource,
  PackageGateway,
  SettingsStore,
  UploadStore,
} from "../../domain/ports.ts";
import type { AppCatalog } from "../../domain/use_cases/app_catalog.ts";
import { appLog } from "../../domain/use_cases/app_log.ts";
import { backupApps } from "../../domain/use_cases/backup.ts";
import { isBatchAction, runBatch } from "../../domain/use_cases/batch.ts";
import { installGroups, type InstallRequest, planInstall } from "../../domain/use_cases/install.ts";
import {
  isHost,
  isPackageName,
  isPermissionName,
  isPort,
  isSerial,
  isUserId,
  requireValid,
} from "../../domain/validation.ts";
import { EventHub, SSE_HEADERS, sseFrame } from "./events.ts";
import { JobRegistry } from "./jobs.ts";
import { Security, SECURITY_HEADERS } from "./security.ts";

export interface Services {
  devices: DeviceRegistry;
  packages: PackageGateway;
  logs: LogSource;
  library: BackupLibrary;
  settings: SettingsStore;
  uploads: UploadStore;
  directories: DirectoryBrowser;
  catalog: AppCatalog;
  adbVersion: string;
}

type Params = Record<string, string>;
type Handler = (request: Request, params: Params, url: URL) => Promise<Response> | Response;

const APP_ACTIONS: readonly AppAction[] = [
  "launch",
  "force-stop",
  "open-settings",
  "enable",
  "disable",
  "clear-data",
  "uninstall",
  "uninstall-keep-data",
  "reinstall-existing",
];
const MAX_JSON_BYTES = 1024 * 1024;
const LOG_FLUSH_MS = 150;
const STATIC_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new AppError("invalid-input", "Expected a JSON body");
  }
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) throw new AppError("invalid-input", "Request too large");
  const parsed = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AppError("invalid-input", "Expected a JSON object");
  }
  return parsed;
}

function stringList(value: unknown, check: (v: unknown) => v is string, what: string): string[] {
  if (!Array.isArray(value) || value.length > 5000) {
    throw new AppError("invalid-input", `Invalid ${what} list`);
  }
  return value.map((item) => requireValid(check, item, what));
}

const userFrom = (value: unknown) =>
  requireValid(isUserId, typeof value === "string" ? Number(value) : value, "user");

const isUploadId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f-]{36}$/.test(value);

function installRequest(body: Record<string, unknown>): InstallRequest {
  const library = Array.isArray(body.library) ? body.library : [];
  return {
    uploadIds: body.uploads === undefined ? [] : stringList(body.uploads, isUploadId, "upload"),
    library: library.map((pick) => ({
      packageName: requireValid(isPackageName, pick?.packageName, "package name"),
      versionCode: requireValid(
        (v: unknown): v is number => Number.isSafeInteger(v),
        pick?.versionCode,
        "version code",
      ),
    })),
  };
}

// Local file paths stay on the server.
const publicGroup = (group: InstallGroup) => ({
  ...group,
  files: group.files.map(({ name, size }) => ({ name, size })),
});
const publicUpload = (upload: Upload) => ({
  ...upload,
  apks: upload.apks.map(({ path: _path, ...apk }) => apk),
});

function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    const status = {
      "invalid-input": 400,
      "not-found": 404,
      "device-unavailable": 409,
      "adb-failed": 502,
      "install-failed": 502,
      "helper-failed": 502,
    }[error.code];
    return json(
      { error: { code: error.code, message: error.message, detail: error.detail ?? null } },
      status,
    );
  }
  if (error instanceof SyntaxError) {
    return json({ error: { code: "invalid-input", message: "Malformed JSON" } }, 400);
  }
  console.error(error);
  return json(
    { error: { code: "internal", message: "Unexpected error. See the terminal for details." } },
    500,
  );
}

export function createApp(services: Services, security: Security, staticRoot: URL) {
  const hub = new EventHub();
  const jobs = new JobRegistry(hub);
  const { devices, packages, logs, library, settings, uploads, directories, catalog } = services;
  const routes: { method: string; pattern: URLPattern; handler: Handler }[] = [];
  const route = (method: string, pathname: string, handler: Handler) =>
    routes.push({ method, pattern: new URLPattern({ pathname }), handler });
  const serialOf = (params: Params) => {
    let serial: string;
    try {
      serial = decodeURIComponent(params.serial);
    } catch {
      throw new AppError("invalid-input", "Invalid serial");
    }
    return requireValid(isSerial, serial, "serial");
  };

  const broadcastDevices = async () => {
    try {
      hub.broadcast("devices", await devices.list());
    } catch (error) {
      console.warn(`Could not list devices: ${error}`);
    }
  };

  route("GET", "/api/state", async () =>
    json({
      devices: await devices.list(),
      settings: await settings.get(),
      jobs: jobs.list(),
      adbVersion: services.adbVersion,
      home: directories.home(),
    }));
  route(
    "GET",
    "/api/events",
    async () => hub.subscribe([["devices", await devices.list()], ["jobs", jobs.list()]]),
  );

  route("GET", "/api/devices/:serial", (_r, p) => devices.info(serialOf(p)).then(json));
  route("GET", "/api/devices/:serial/apps", async (_r, p, url) => {
    const serial = serialOf(p);
    const apps = await catalog.list(serial, userFrom(url.searchParams.get("user") ?? "0"));
    return json({ apps, metadataLoaded: catalog.hasMetadata(serial) });
  });
  route("POST", "/api/devices/:serial/apps/metadata", async (request, p) => {
    const body = await readJson(request);
    return json({
      apps: await catalog.loadMetadata(serialOf(p), userFrom(body.user ?? 0)),
      metadataLoaded: true,
    });
  });
  route(
    "GET",
    "/api/devices/:serial/apps/:package",
    (_r, p) =>
      packages.details(serialOf(p), requireValid(isPackageName, p.package, "package name")).then(json),
  );
  route("GET", "/api/devices/:serial/icons/:package", (_r, p) => {
    const icon = catalog.icon(serialOf(p), requireValid(isPackageName, p.package, "package name"));
    if (!icon) return new Response(null, { status: 404 });
    return new Response(icon, {
      headers: { "content-type": "image/png", "cache-control": "private, max-age=86400" },
    });
  });
  route("POST", "/api/devices/:serial/apps/:package/action", async (request, p) => {
    const body = await readJson(request);
    const action = body.action as AppAction;
    if (!APP_ACTIONS.includes(action)) throw new AppError("invalid-input", "Unknown action");
    await packages.act(
      serialOf(p),
      requireValid(isPackageName, p.package, "package name"),
      userFrom(body.user),
      action,
    );
    return json({ ok: true });
  });
  route("POST", "/api/devices/:serial/apps/:package/permission", async (request, p) => {
    const body = await readJson(request);
    await packages.setPermission(
      serialOf(p),
      requireValid(isPackageName, p.package, "package name"),
      userFrom(body.user),
      requireValid(isPermissionName, body.permission, "permission"),
      body.granted === true,
    );
    return json({ ok: true });
  });

  route("POST", "/api/devices/:serial/batch", async (request, p) => {
    const serial = serialOf(p);
    const body = await readJson(request);
    if (!isBatchAction(body.action)) throw new AppError("invalid-input", "Unknown batch action");
    const action = body.action;
    const names = stringList(body.packages, isPackageName, "package name");
    const user = userFrom(body.user);
    const title = `${action.replaceAll("-", " ")}: ${names.length} app${names.length === 1 ? "" : "s"}`;
    return json(
      jobs.start(
        title,
        serial,
        names.length,
        (report) => runBatch(packages, serial, user, action, names, report),
      ),
    );
  });
  route("POST", "/api/devices/:serial/backup", async (request, p) => {
    const serial = serialOf(p);
    const body = await readJson(request);
    const names = stringList(body.packages, isPackageName, "package name");
    const user = userFrom(body.user);
    const title = `Back up ${names.length === 1 ? names[0] : `${names.length} apps`}`;
    return json(
      jobs.start(
        title,
        serial,
        names.length,
        (report) => backupApps({ devices, packages, library }, serial, user, names, report),
      ),
    );
  });
  route("POST", "/api/devices/:serial/install/plan", async (request, p) => {
    const body = await readJson(request);
    const groups = await planInstall(
      { devices, packages, library, uploads },
      serialOf(p),
      userFrom(body.user),
      installRequest(body),
    );
    return json(groups.map(publicGroup));
  });
  route("POST", "/api/devices/:serial/install", async (request, p) => {
    const serial = serialOf(p);
    const body = await readJson(request);
    const user = userFrom(body.user);
    const install = installRequest(body);
    const groups = await planInstall({ devices, packages, library, uploads }, serial, user, install);
    const options = {
      user,
      grantPermissions: body.grantPermissions === true,
      allowDowngrade: body.allowDowngrade === true,
    };
    const title = `Install ${
      groups.length === 1 ? groups[0].label ?? groups[0].packageName ?? "APK" : `${groups.length} apps`
    }`;
    return json(jobs.start(
      title,
      serial,
      groups.length,
      (report) => installGroups(packages, serial, groups, options, report),
      () => install.uploadIds.forEach((id) => uploads.remove(id)),
    ));
  });
  route("GET", "/api/devices/:serial/logcat", (request, p, url) => {
    const serial = serialOf(p);
    const packageName = requireValid(isPackageName, url.searchParams.get("package"), "package name");
    const abort = new AbortController();
    request.signal.addEventListener("abort", () => abort.abort());
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let batch: LogLine[] = [];
        let timer: number | undefined;
        const flush = () => {
          timer = undefined;
          if (batch.length === 0) return;
          try {
            controller.enqueue(sseFrame("lines", batch));
          } catch {
            abort.abort();
          }
          batch = [];
        };
        try {
          for await (const line of appLog(logs, serial, packageName, abort.signal)) {
            batch.push(line);
            timer ??= setTimeout(flush, LOG_FLUSH_MS);
          }
        } catch (error) {
          if (!abort.signal.aborted) console.warn(`logcat stopped: ${error}`);
        }
        clearTimeout(timer);
        flush();
        try {
          controller.enqueue(sseFrame("end", { reason: abort.signal.aborted ? "closed" : "device" }));
          controller.close();
        } catch {
          // client already gone
        }
      },
      cancel: () => abort.abort(),
    });
    return new Response(body, { headers: SSE_HEADERS });
  });

  route("PUT", "/api/uploads", async (request, _p, url) => {
    const name = url.searchParams.get("name") ?? "";
    if (!name || name.length > 255 || !request.body) throw new AppError("invalid-input", "Missing file");
    return json(publicUpload(await uploads.save(name, request.body)));
  });
  route("DELETE", "/api/uploads/:id", async (_r, p) => {
    await uploads.remove(requireValid(isUploadId, p.id, "upload"));
    return json({ ok: true });
  });

  route("GET", "/api/library", async () => json(await library.list()));
  route("DELETE", "/api/library/:package/:versionCode", async (_r, p) => {
    await library.remove(requireValid(isPackageName, p.package, "package name"), Number(p.versionCode));
    return json({ ok: true });
  });

  route("GET", "/api/settings", async () => json(await settings.get()));
  route("PUT", "/api/settings", async (request) => {
    const body = await readJson(request);
    return json(
      await settings.update({
        ...(typeof body.backupDirectory === "string" ? { backupDirectory: body.backupDirectory } : {}),
        ...(typeof body.autoLoadMetadata === "boolean" ? { autoLoadMetadata: body.autoLoadMetadata } : {}),
      }),
    );
  });
  route(
    "GET",
    "/api/fs/dirs",
    async (_r, _p, url) => json(await directories.list(url.searchParams.get("path") ?? "")),
  );
  route("POST", "/api/fs/dirs", async (request) => {
    const body = await readJson(request);
    if (typeof body.path !== "string" || !body.path) throw new AppError("invalid-input", "Missing path");
    await directories.create(body.path);
    return json({ ok: true });
  });

  route("GET", "/api/adb/discover", async () => json(await devices.discover()));
  route("POST", "/api/adb/pair", async (request) => {
    const body = await readJson(request);
    const message = await devices.pair(
      requireValid(isHost, body.host, "host"),
      requireValid(isPort, body.port, "port"),
      String(body.code ?? ""),
    );
    return json({ message });
  });
  route("POST", "/api/adb/connect", async (request) => {
    const body = await readJson(request);
    const message = await devices.connect(
      requireValid(isHost, body.host, "host"),
      requireValid(isPort, body.port, "port"),
    );
    await broadcastDevices();
    return json({ message });
  });
  route("POST", "/api/adb/disconnect", async (request) => {
    const body = await readJson(request);
    await devices.disconnect(requireValid(isSerial, body.serial, "serial"));
    await broadcastDevices();
    return json({ ok: true });
  });

  const serveStatic = async (pathname: string): Promise<Response> => {
    const file = pathname === "/" ? "index.html" : pathname.slice(1);
    const type = STATIC_TYPES[extname(file)];
    if (!type || file.includes("..") || file.includes("/")) return new Response("Not found", { status: 404 });
    try {
      const data = await Deno.readFile(fromFileUrl(new URL(file, staticRoot)));
      return new Response(data, { headers: { "content-type": type, "cache-control": "no-cache" } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  };

  const handle = async (request: Request): Promise<Response> => {
    if (!security.hostAllowed(request)) return new Response("Unknown host", { status: 421 });
    const url = new URL(request.url);
    if (url.pathname === "/login") return security.login(url);
    if (!url.pathname.startsWith("/api/")) {
      return request.method === "GET" ? serveStatic(url.pathname) : new Response(null, { status: 405 });
    }
    if (!security.originAllowed(request) || !security.authenticated(request)) {
      return json(
        { error: { code: "unauthorized", message: "Open the address printed in the terminal" } },
        401,
      );
    }
    for (const { method, pattern, handler } of routes) {
      const match = pattern.exec({ pathname: url.pathname });
      if (!match) continue;
      if (method !== request.method) continue;
      try {
        return await handler(request, match.pathname.groups as Params, url);
      } catch (error) {
        return errorResponse(error);
      }
    }
    return json({ error: { code: "not-found", message: "No such endpoint" } }, 404);
  };

  return {
    hub,
    broadcastDevices,
    fetch: async (request: Request) => {
      const response = await handle(request);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
      return response;
    },
  };
}
