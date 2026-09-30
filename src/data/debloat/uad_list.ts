import { join } from "@std/path";
import {
  type DebloatCategory,
  type DebloatEntry,
  type DebloatLevel,
  type DebloatList,
  type DebloatSourceInfo,
  trackingMention,
} from "../../domain/debloat.ts";
import type { DebloatSource } from "../../domain/ports.ts";
import { isPackageName } from "../../domain/validation.ts";

// Downloaded at runtime instead of bundled: the list is GPL-3.0 and this app is MIT.
export const UAD_SOURCE: DebloatSourceInfo = {
  name: "Universal Android Debloater Next Generation",
  url: "https://github.com/Universal-Debloater-Alliance/universal-android-debloater-next-generation",
  license: "GPL-3.0",
};
export const UAD_LIST_URL = "https://raw.githubusercontent.com/Universal-Debloater-Alliance/" +
  "universal-android-debloater-next-generation/main/resources/assets/uad_lists.json";

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_DESCRIPTION = 4000;
const MIN_ENTRIES = 100; // anything smaller is not the real list
const LIST_FILE = "uad_lists.json";
const META_FILE = "uad_lists.meta.json";

const LEVELS: Record<string, DebloatLevel> = {
  Recommended: "recommended",
  Advanced: "advanced",
  Expert: "expert",
  Unsafe: "unsafe",
};
const CATEGORIES: Record<string, DebloatCategory> = {
  Oem: "oem",
  Aosp: "aosp",
  Google: "google",
  Carrier: "carrier",
  Misc: "misc",
};

const packageList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(isPackageName).slice(0, 100) : [];

/** Parses uad_lists.json, skipping entries it does not understand. The file is untrusted input. */
export function parseUadList(text: string): Map<string, DebloatEntry> {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Unexpected list format");
  }
  const entries = new Map<string, DebloatEntry>();
  for (const [packageName, value] of Object.entries(raw as Record<string, Record<string, unknown>>)) {
    const level = LEVELS[String(value?.removal)];
    if (!isPackageName(packageName) || !level) continue;
    const description = typeof value.description === "string"
      ? value.description.trim().slice(0, MAX_DESCRIPTION)
      : "";
    entries.set(packageName, {
      level,
      category: CATEGORIES[String(value.list)] ?? "misc",
      description,
      dependencies: packageList(value.dependencies),
      neededBy: packageList(value.neededBy),
      tracking: trackingMention(description),
    });
  }
  if (entries.size < MIN_ENTRIES) throw new Error(`The list has only ${entries.size} usable entries`);
  return entries;
}

async function readLimited(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error("The list is unexpectedly large");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(await new Blob(chunks as BlobPart[]).arrayBuffer());
}

/** Keeps the last downloaded copy in a cache folder so hints work offline. */
export class UadDebloatSource implements DebloatSource {
  readonly info = UAD_SOURCE;

  constructor(
    private readonly directory: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly url = UAD_LIST_URL,
  ) {}

  async cached(): Promise<DebloatList | null> {
    try {
      const [text, meta] = await Promise.all([
        Deno.readTextFile(join(this.directory, LIST_FILE)),
        Deno.readTextFile(join(this.directory, META_FILE)).then(JSON.parse),
      ]);
      if (typeof meta?.updatedAt !== "string" || Number.isNaN(Date.parse(meta.updatedAt))) return null;
      return { entries: parseUadList(text), updatedAt: meta.updatedAt, source: UAD_SOURCE };
    } catch {
      return null;
    }
  }

  async download(): Promise<DebloatList> {
    const response = await this.fetchFn(this.url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Downloading the bloatware list failed (HTTP ${response.status})`);
    }
    const text = await readLimited(response);
    const entries = parseUadList(text);
    const updatedAt = new Date().toISOString();
    await Deno.mkdir(this.directory, { recursive: true });
    await writeAtomically(join(this.directory, LIST_FILE), text);
    await writeAtomically(join(this.directory, META_FILE), JSON.stringify({ updatedAt, url: this.url }));
    return { entries, updatedAt, source: UAD_SOURCE };
  }
}

async function writeAtomically(path: string, text: string): Promise<void> {
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  await Deno.writeTextFile(temp, text);
  await Deno.rename(temp, path);
}
