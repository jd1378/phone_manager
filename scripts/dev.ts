// Runs the app from source with the same permissions as the compiled build.
import { dirname, fromFileUrl, join } from "@std/path";
import { PERMISSIONS } from "./permissions.ts";

const root = join(dirname(fromFileUrl(import.meta.url)), "..");
const child = new Deno.Command(Deno.execPath(), {
  args: ["run", ...PERMISSIONS, "src/main.ts", ...Deno.args],
  cwd: root,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
}).spawn();
// Ctrl+C reaches the child directly; wait for it to clean up.
Deno.addSignalListener("SIGINT", () => {});
Deno.exit((await child.status).code);
