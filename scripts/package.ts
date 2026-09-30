// Packages the desktop app with `deno desktop` into build/.
// Usage: deno task package                    (this machine's platform)
//        deno task package --all              (every target this host can build)
//        deno task package linux-x64 windows-x64
import { dirname, extname, fromFileUrl, join } from "@std/path";
import { PERMISSIONS } from "./permissions.ts";

type Os = "linux" | "windows" | "darwin";

const TARGETS: Record<string, { triple: string; os: Os }> = {
  "linux-x64": { triple: "x86_64-unknown-linux-gnu", os: "linux" },
  "linux-arm64": { triple: "aarch64-unknown-linux-gnu", os: "linux" },
  "windows-x64": { triple: "x86_64-pc-windows-msvc", os: "windows" },
  "macos-arm64": { triple: "aarch64-apple-darwin", os: "darwin" },
  "macos-x64": { triple: "x86_64-apple-darwin", os: "darwin" },
};

// The output extension selects the format. The file name becomes the package and program name
// inside the installer, so it stays fixed; the version is added when the result is moved out.
const OUTPUTS: Record<Os, string[]> = {
  linux: ["phone-manager.AppImage", "phone-manager.deb", "phone-manager.rpm"],
  windows: ["phone-manager.msi"],
  darwin: ["Phone Manager.dmg"],
};

// Older versions stamp every installer as version 1.0.0 and mangle names containing dots.
const MIN_DENO = [2, 9, 6];
const current = Deno.version.deno.split(/[.-]/).slice(0, 3).map(Number);
const firstDifference = MIN_DENO.findIndex((part, i) => current[i] !== part);
if (firstDifference >= 0 && current[firstDifference] < MIN_DENO[firstDifference]) {
  console.error(
    `deno desktop packaging needs Deno ${MIN_DENO.join(".")} or newer; this is ${Deno.version.deno}.`,
  );
  Deno.exit(1);
}

const root = join(dirname(fromFileUrl(import.meta.url)), "..");
const { version } = JSON.parse(await Deno.readTextFile(join(root, "deno.json")));
if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`deno.json needs a "version" like 1.2.3, got ${version}`);
}

// macOS bundles need iconutil, hdiutil and codesign (Apple Silicon refuses unsigned apps).
const buildable = (name: string) => TARGETS[name].os !== "darwin" || Deno.build.os === "darwin";
const named = Deno.args.filter((arg) => !arg.startsWith("--"));
for (const name of named) {
  if (!(name in TARGETS)) {
    throw new Error(`Unknown target ${name}. Known: ${Object.keys(TARGETS).join(", ")}`);
  }
  if (!buildable(name)) throw new Error(`${name} can only be packaged on macOS`);
}
const host = Object.keys(TARGETS).find((name) =>
  TARGETS[name].os === Deno.build.os && TARGETS[name].triple.startsWith(Deno.build.arch)
);
const selected = Deno.args.includes("--all")
  ? Object.keys(TARGETS).filter(buildable)
  : named.length > 0
  ? named
  : [host!];

async function deno(args: string[]) {
  const { code } = await new Deno.Command(Deno.execPath(), {
    args,
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  })
    .output();
  if (code !== 0) Deno.exit(code);
}

await deno(["task", "build:web"]);
const staging = join(root, "build", ".staging");
for (const name of selected) {
  const { triple, os } = TARGETS[name];
  for (const output of OUTPUTS[os]) {
    await Deno.remove(staging, { recursive: true }).catch(() => {});
    const staged = join(staging, output);
    await deno([
      "desktop",
      "--quiet",
      ...PERMISSIONS,
      "--include",
      "dist",
      "--include",
      "src/data/adb/phone-helper.dex",
      "--target",
      triple,
      "--output",
      staged,
      "src/desktop.ts",
    ]);
    const final = join(root, "build", `phone-manager-${version}-${name}${extname(output)}`);
    await Deno.remove(final, { recursive: true }).catch(() => {});
    await Deno.rename(staged, final);
    console.log(`Packaged ${final}`);
  }
}
await Deno.remove(staging, { recursive: true }).catch(() => {});
