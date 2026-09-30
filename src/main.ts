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
import { configDirectory, homeDirectory, openBrowser } from "./data/platform.ts";
import { AppCatalog } from "./domain/use_cases/app_catalog.ts";
import { Security } from "./presentation/http/security.ts";
import { createApp } from "./presentation/http/server.ts";

const USAGE = `Usage: phone-manager [--port <number>] [--no-open]

  --port     Port to listen on at 127.0.0.1 (default: a free port)
  --no-open  Do not open the browser`;

function parseArgs(args: string[]): { port: number; open: boolean } {
  let port = 0;
  let open = true;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--no-open") open = false;
    else if (arg === "--port" || arg.startsWith("--port=")) {
      port = Number(arg.includes("=") ? arg.split("=")[1] : args[++i]);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port needs a number");
    } else if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      Deno.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { port, open };
}

async function main() {
  let options: { port: number; open: boolean };
  try {
    options = parseArgs(Deno.args);
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${USAGE}`);
    Deno.exit(2);
  }

  const adb = new Adb();
  let adbVersion: string;
  try {
    adbVersion = await adb.version();
  } catch {
    console.error(
      "adb was not found. Install Android SDK Platform-Tools and make sure `adb` is on your PATH:\n" +
        "  https://developer.android.com/tools/releases/platform-tools",
    );
    Deno.exit(1);
  }
  await adb.run(["start-server"]);

  const home = homeDirectory();
  const settings = new JsonSettingsStore(join(configDirectory("phone-manager"), "settings.json"), {
    backupDirectory: join(home, "phone-manager-backups"),
    autoLoadMetadata: false,
  });
  const uploadsRoot = await Deno.makeTempDir({ prefix: "phone-manager-uploads-" });
  const packages = new AdbPackages(adb, await PhoneHelper.load(adb));
  const devices = new AdbDevices(adb);

  const shutdown = new AbortController();
  // The port is only known once listening, and the app needs it for its Host/Origin checks.
  let handle = (_request: Request) => Promise.resolve(new Response("Starting", { status: 503 }));
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: options.port,
    signal: shutdown.signal,
    onListen: () => {},
  }, (request) => handle(request));

  const port = server.addr.port;
  const security = new Security(port);
  const app = createApp(
    {
      devices,
      packages,
      logs: new AdbLogcat(adb),
      library: new FsBackupLibrary(async () => (await settings.get()).backupDirectory),
      settings,
      uploads: new TempUploadStore(uploadsRoot),
      directories: new FsDirectoryBrowser(home),
      catalog: new AppCatalog(packages),
      adbVersion,
    },
    security,
    new URL("../dist/", import.meta.url),
  );
  handle = app.fetch;
  devices.watch(() => app.broadcastDevices(), shutdown.signal);

  const url = security.loginUrl(port);
  console.log(`Phone Manager is running (${adbVersion}).\nOpen: ${url}\nPress Ctrl+C to stop.`);
  if (options.open && !(await openBrowser(url))) {
    console.log("Could not open a browser; open the address above.");
  }

  const stop = async () => {
    shutdown.abort();
    await Deno.remove(uploadsRoot, { recursive: true }).catch(() => {});
    Deno.exit(0);
  };
  Deno.addSignalListener("SIGINT", stop);
  if (Deno.build.os !== "windows") Deno.addSignalListener("SIGTERM", stop);
  await server.finished;
}

if (import.meta.main) await main();
