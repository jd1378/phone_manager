// Composition root shared by the browser (main.ts) and desktop (desktop.ts) entrypoints.
import { join } from "@std/path";
import { Adb } from "./data/adb/adb.ts";
import { AdbDevices } from "./data/adb/adb_devices.ts";
import { AdbLogcat } from "./data/adb/adb_logcat.ts";
import { AdbPackages } from "./data/adb/adb_packages.ts";
import { PhoneHelper } from "./data/adb/phone_helper.ts";
import { FsDirectoryBrowser } from "./data/fs/directory_browser.ts";
import { FsBackupLibrary } from "./data/fs/fs_library.ts";
import { JsonSettingsStore } from "./data/fs/json_settings.ts";
import { TempUploadStore } from "./data/fs/upload_store.ts";
import { UadDebloatSource } from "./data/debloat/uad_list.ts";
import { cacheDirectory, configDirectory, homeDirectory } from "./data/platform.ts";
import { AppCatalog } from "./domain/use_cases/app_catalog.ts";
import { BloatwareHints } from "./domain/use_cases/bloatware_hints.ts";
import { Security } from "./presentation/http/security.ts";
import { createApp } from "./presentation/http/server.ts";

export const ADB_MISSING_MESSAGE =
  "adb was not found on your PATH or in the Android SDK folder. Install Android SDK Platform-Tools:\n" +
  "https://developer.android.com/tools/releases/platform-tools";

/** Env reads outside the granted list throw; treat them as unset. */
const readEnv = (name: string) => {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
};

export class AdbMissingError extends Error {
  constructor() {
    super(ADB_MISSING_MESSAGE);
    this.name = "AdbMissingError";
  }
}

export interface RunningApp {
  port: number;
  adbVersion: string;
  /** Per-run secret that unlocks the API; see Security. */
  token: string;
  loginUrl: string;
  finished: Promise<void>;
  shutdown(): Promise<void>;
}

/** Checks adb, wires the layers and starts the HTTP server on 127.0.0.1. */
export async function startApp(port: number): Promise<RunningApp> {
  const adb = await Adb.locate(readEnv, Deno.build.os);
  if (!adb) throw new AdbMissingError();
  const adbVersion = await adb.version();
  await adb.run(["start-server"]);

  const home = homeDirectory();
  const settings = new JsonSettingsStore(join(configDirectory("phone-manager"), "settings.json"), {
    backupDirectory: join(home, "phone-manager-backups"),
    autoLoadMetadata: false,
    bloatwareHints: false,
  });
  const hints = new BloatwareHints(new UadDebloatSource(cacheDirectory("phone-manager")), settings);
  const uploadsRoot = await Deno.makeTempDir({ prefix: "phone-manager-uploads-" });
  const packages = new AdbPackages(adb, await PhoneHelper.load(adb));
  const devices = new AdbDevices(adb);

  const stop = new AbortController();
  // The port is only known once listening (deno desktop even picks it itself), and the app needs
  // it for its Host/Origin checks.
  let handle = (_request: Request) => Promise.resolve(new Response("Starting", { status: 503 }));
  const server = Deno.serve(
    { hostname: "127.0.0.1", port, signal: stop.signal, onListen: () => {} },
    (request) => handle(request),
  );
  const security = new Security(server.addr.port);
  const app = createApp(
    {
      devices,
      packages,
      logs: new AdbLogcat(adb),
      library: new FsBackupLibrary(async () => (await settings.get()).backupDirectory),
      settings,
      uploads: new TempUploadStore(uploadsRoot),
      directories: new FsDirectoryBrowser(home),
      catalog: new AppCatalog(packages, hints),
      hints,
      adbVersion,
    },
    security,
    new URL("../dist/", import.meta.url),
  );
  handle = app.fetch;
  devices.watch(() => app.broadcastDevices(), stop.signal);

  return {
    port: server.addr.port,
    adbVersion,
    token: security.token,
    loginUrl: security.loginUrl(server.addr.port),
    finished: server.finished,
    shutdown: async () => {
      stop.abort();
      await Deno.remove(uploadsRoot, { recursive: true }).catch(() => {});
    },
  };
}
