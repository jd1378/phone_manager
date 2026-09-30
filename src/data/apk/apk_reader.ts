import { basename, join } from "@std/path";
import type { ApkManifest, InspectedApk } from "../../domain/models.ts";
import { parseManifest } from "./binary_xml.ts";
import { ZipFile } from "./zip.ts";

export const BUNDLE_EXTENSIONS = [".apks", ".xapk", ".apkm", ".zip"];

export async function readApkManifest(path: string): Promise<ApkManifest> {
  const zip = await ZipFile.open(path);
  try {
    const entry = zip.find("AndroidManifest.xml");
    if (!entry) throw new Error("No AndroidManifest.xml");
    return parseManifest(await zip.read(entry));
  } finally {
    zip.close();
  }
}

export async function inspectApk(path: string): Promise<InspectedApk> {
  const { size } = await Deno.stat(path);
  const manifest = await readApkManifest(path).catch(() => null);
  return { fileName: basename(path), path, size, manifest };
}

/**
 * Picks the APKs to install from a bundle. bundletool .apks files carry both device splits and
 * pre-Lollipop "standalones"; only the splits are wanted.
 */
export function bundleApkEntries(names: readonly string[]): string[] {
  const apks = names.filter((name) => name.toLowerCase().endsWith(".apk") && !name.endsWith("/"));
  const splits = apks.filter((name) => name.startsWith("splits/"));
  return splits.length > 0 ? splits : apks.filter((name) => !name.startsWith("standalones/"));
}

/** Safe, unique local name for a bundle entry like "splits/base-master.apk". */
function localName(entryName: string, taken: Set<string>): string {
  const base = (entryName.split("/").at(-1) ?? "split.apk").replace(/[^A-Za-z0-9_.-]/g, "_").replace(
    /^[.-]+/,
    "",
  );
  let name = base || "split.apk";
  for (let n = 2; taken.has(name); n++) name = base.replace(/\.apk$/i, `-${n}.apk`);
  taken.add(name);
  return name;
}

/** Extracts a bundle's APKs into a directory and returns their paths. */
export async function extractBundle(bundlePath: string, directory: string): Promise<string[]> {
  const zip = await ZipFile.open(bundlePath);
  try {
    const wanted = new Set(bundleApkEntries(zip.entries.map((entry) => entry.name)));
    if (wanted.size === 0) throw new Error("The bundle contains no APK files");
    const taken = new Set<string>();
    const paths: string[] = [];
    for (const entry of zip.entries) {
      if (!wanted.has(entry.name)) continue;
      const path = join(directory, localName(entry.name, taken));
      const file = await Deno.open(path, { write: true, createNew: true });
      await (await zip.stream(entry)).pipeTo(file.writable);
      paths.push(path);
    }
    return paths;
  } finally {
    zip.close();
  }
}
