// Builds self-contained executables into build/. Run `deno task build:web` first (the compile task does).
// Usage: deno task compile                 (this machine's platform)
//        deno task compile --all           (Linux, macOS and Windows)
//        deno task compile windows-x64     (named targets, see TARGETS)
import { dirname, fromFileUrl, join } from "@std/path";
import { permissions } from "./permissions.ts";

const TARGETS: Record<string, { target: string; os: string }> = {
  "linux-x64": { target: "x86_64-unknown-linux-gnu", os: "linux" },
  "linux-arm64": { target: "aarch64-unknown-linux-gnu", os: "linux" },
  "macos-x64": { target: "x86_64-apple-darwin", os: "darwin" },
  "macos-arm64": { target: "aarch64-apple-darwin", os: "darwin" },
  "windows-x64": { target: "x86_64-pc-windows-msvc", os: "windows" },
};

const root = join(dirname(fromFileUrl(import.meta.url)), "..");
const hostTarget = `${Deno.build.arch}-${
  { linux: "unknown-linux-gnu", darwin: "apple-darwin", windows: "pc-windows-msvc" }[Deno.build.os as string]
}`;
const named = Deno.args.filter((arg) => !arg.startsWith("--"));
const selected = Deno.args.includes("--all")
  ? Object.entries(TARGETS)
  : named.length > 0
  ? Object.entries(TARGETS).filter(([name]) => named.includes(name))
  : Object.entries(TARGETS).filter(([, { target }]) => target === hostTarget);
if (selected.length === 0) {
  throw new Error(`No matching build target. Known: ${Object.keys(TARGETS).join(", ")}`);
}

for (const [name, { target, os }] of selected) {
  const output = join(root, "build", `phone-manager-${name}`);
  const { code } = await new Deno.Command(Deno.execPath(), {
    args: [
      "compile",
      ...permissions(os),
      "--include",
      "dist",
      "--include",
      "src/data/adb/phone-helper.dex",
      "--target",
      target,
      "--output",
      output,
      "src/main.ts",
    ],
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (code !== 0) Deno.exit(code);
}
