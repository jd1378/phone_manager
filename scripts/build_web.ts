// Bundles the browser UI into dist/.
import { dirname, fromFileUrl, join } from "@std/path";

const root = join(dirname(fromFileUrl(import.meta.url)), "..");
const web = join(root, "src", "presentation", "web");
const dist = join(root, "dist");

await Deno.mkdir(dist, { recursive: true });
const { code } = await new Deno.Command(Deno.execPath(), {
  args: [
    "bundle",
    "--quiet",
    "--platform",
    "browser",
    "--minify",
    "--output",
    join(dist, "app.js"),
    join(web, "main.tsx"),
  ],
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
}).output();
if (code !== 0) Deno.exit(code);
for (const file of ["index.html", "styles.css", "icon.svg"]) {
  await Deno.copyFile(join(web, file), join(dist, file));
}
console.log(`Built ${dist}`);
