// Builds the on-phone helper dex. Needs a JDK (javac) and an Android SDK with build-tools and a platform.
// Usage: deno task build:helper
import { dirname, fromFileUrl, join } from "@std/path";

const root = dirname(fromFileUrl(import.meta.url));
const output = join(root, "..", "src", "data", "adb", "phone-helper.dex");
const isWindows = Deno.build.os === "windows";

function sdkRoot(): string {
  const fromEnv = Deno.env.get("ANDROID_HOME") ?? Deno.env.get("ANDROID_SDK_ROOT");
  if (fromEnv) return fromEnv;
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "";
  if (Deno.build.os === "darwin") return join(home, "Library", "Android", "sdk");
  if (isWindows) return join(Deno.env.get("LOCALAPPDATA") ?? home, "Android", "Sdk");
  return join(home, "Android", "Sdk");
}

async function newestDir(parent: string, contains: string): Promise<string> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(parent)) {
    if (!entry.isDirectory) continue;
    try {
      await Deno.stat(join(parent, entry.name, contains));
      names.push(entry.name);
    } catch {
      // incomplete install, skip
    }
  }
  if (names.length === 0) throw new Error(`No ${contains} found under ${parent}`);
  const version = (name: string) =>
    name.replace(/^android-/, "").split(".").map((part) => parseInt(part) || 0);
  names.sort((a, b) => {
    const [va, vb] = [version(a), version(b)];
    for (let i = 0; i < Math.max(va.length, vb.length); i++) {
      if ((va[i] ?? 0) !== (vb[i] ?? 0)) return (va[i] ?? 0) - (vb[i] ?? 0);
    }
    return 0;
  });
  return join(parent, names.at(-1)!);
}

async function run(command: string, args: string[]) {
  const { code } = await new Deno.Command(command, { args, stdout: "inherit", stderr: "inherit" }).output();
  if (code !== 0) throw new Error(`${command} exited with ${code}`);
}

const sdk = sdkRoot();
const androidJar = join(await newestDir(join(sdk, "platforms"), "android.jar"), "android.jar");
const d8Name = isWindows ? "d8.bat" : "d8";
const buildTools = await newestDir(join(sdk, "build-tools"), d8Name);
const work = await Deno.makeTempDir({ prefix: "phone-helper-" });
try {
  const classes = join(work, "classes");
  await run("javac", [
    "-source",
    "8",
    "-target",
    "8",
    "-Xlint:-options",
    "-bootclasspath",
    androidJar,
    "-d",
    classes,
    join(root, "src", "phonemanager", "Helper.java"),
  ]);
  const classFiles: string[] = [];
  for await (const entry of Deno.readDir(join(classes, "phonemanager"))) {
    if (entry.name.endsWith(".class")) classFiles.push(join(classes, "phonemanager", entry.name));
  }
  await run(join(buildTools, d8Name), [
    "--release",
    "--min-api",
    "21",
    "--lib",
    androidJar,
    "--output",
    work,
    ...classFiles,
  ]);
  await Deno.copyFile(join(work, "classes.dex"), output);
  console.log(`Wrote ${output}`);
} finally {
  await Deno.remove(work, { recursive: true });
}
