// Browser mode: serves the UI on 127.0.0.1 and opens it in the default browser.
import { openBrowser } from "./data/platform.ts";
import { AdbMissingError, startApp } from "./app.ts";

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

  let app;
  try {
    app = await startApp(options.port);
  } catch (error) {
    if (!(error instanceof AdbMissingError)) throw error;
    console.error(error.message);
    Deno.exit(1);
  }

  console.log(`Phone Manager is running (${app.adbVersion}).\nOpen: ${app.loginUrl}\nPress Ctrl+C to stop.`);
  if (options.open && !(await openBrowser(app.loginUrl))) {
    console.log("Could not open a browser; open the address above.");
  }

  const stop = async () => {
    await app.shutdown();
    Deno.exit(0);
  };
  Deno.addSignalListener("SIGINT", stop);
  if (Deno.build.os !== "windows") Deno.addSignalListener("SIGTERM", stop);
  await app.finished;
}

if (import.meta.main) await main();
