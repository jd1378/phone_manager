// Desktop mode, built with `deno desktop`: the runtime opens a native window on our server.
import { AdbMissingError, type RunningApp, startApp } from "./app.ts";

let app: RunningApp;
try {
  app = await startApp(0);
} catch (error) {
  alert(error instanceof AdbMissingError ? error.message : `Phone Manager could not start: ${error}`);
  Deno.exit(1);
}

// The first window constructed adopts the one the runtime opened. The page cannot receive the
// session token through a URL here, so it asks for it over a binding, which only our webview can call.
const window = new Deno.BrowserWindow({ title: "Phone Manager", width: 1280, height: 820 });
window.bind("sessionToken", () => Promise.resolve(app.token));
// The server and device watcher would keep the process alive after the window closes.
window.addEventListener("close", async () => {
  await app.shutdown();
  Deno.exit(0);
});
