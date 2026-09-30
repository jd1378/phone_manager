import { crypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import { join } from "@std/path";
import { AppError } from "../../domain/errors.ts";
import type { ApkFile, BackupMetadata, LibraryEntry } from "../../domain/models.ts";
import type { BackupLibrary, NewBackup, StagedBackup } from "../../domain/ports.ts";
import { isApkFileName, isPackageName, requireValid } from "../../domain/validation.ts";

const METADATA_FILE = "metadata.json";
const STAGING_PREFIX = ".staging-";

/**
 * Backups live at <root>/<package>/<versionCode>/ holding the APKs and metadata.json.
 * The folder tree is the source of truth, so moving or deleting folders by hand is fine.
 */
export class FsBackupLibrary implements BackupLibrary {
  constructor(private readonly root: () => Promise<string>) {}

  async list(): Promise<LibraryEntry[]> {
    const root = await this.root();
    const entries: LibraryEntry[] = [];
    for (const packageName of await subdirectories(root)) {
      if (!isPackageName(packageName)) continue;
      for (const version of await subdirectories(join(root, packageName))) {
        if (!/^\d+$/.test(version)) continue;
        const entry = await readEntry(join(root, packageName, version));
        if (entry) entries.push(entry);
      }
    }
    return entries;
  }

  async get(packageName: string, versionCode: number): Promise<LibraryEntry | null> {
    return readEntry(await this.#directory(packageName, versionCode));
  }

  async stage(packageName: string, versionCode: number): Promise<StagedBackup> {
    const target = await this.#directory(packageName, versionCode);
    const parent = join(target, "..");
    await Deno.mkdir(parent, { recursive: true });
    const staging = join(parent, `${STAGING_PREFIX}${versionCode}-${crypto.randomUUID()}`);
    await Deno.mkdir(staging);
    return {
      pathFor: (fileName) => join(staging, requireValid(isApkFileName, fileName, "APK file name")),
      commit: async (backup) => {
        const metadata = await describe(staging, backup);
        await Deno.writeTextFile(join(staging, METADATA_FILE), JSON.stringify(metadata, null, 2) + "\n");
        try {
          await Deno.rename(staging, target);
        } catch (error) {
          // Another backup of the same version finished first; keep that one.
          const existing = await readEntry(target);
          await Deno.remove(staging, { recursive: true }).catch(() => {});
          if (existing) return existing;
          throw error;
        }
        return { ...metadata, directory: target };
      },
      abort: () => Deno.remove(staging, { recursive: true }).catch(() => {}),
    };
  }

  filePath(entry: LibraryEntry, fileName: string): string {
    if (!entry.files.some((file) => file.name === fileName)) {
      throw new AppError("not-found", `${fileName} is not part of this backup`);
    }
    return join(entry.directory, requireValid(isApkFileName, fileName, "APK file name"));
  }

  async remove(packageName: string, versionCode: number): Promise<void> {
    const directory = await this.#directory(packageName, versionCode);
    if (!(await readEntry(directory))) throw new AppError("not-found", "Backup not found");
    await Deno.remove(directory, { recursive: true });
    await Deno.remove(join(directory, "..")).catch(() => {}); // only succeeds when empty
  }

  async #directory(packageName: string, versionCode: number): Promise<string> {
    requireValid(isPackageName, packageName, "package name");
    if (!Number.isSafeInteger(versionCode) || versionCode < 0) {
      throw new AppError("invalid-input", "Invalid version code");
    }
    return join(await this.root(), packageName, String(versionCode));
  }
}

async function subdirectories(path: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(path)) {
      if (entry.isDirectory && !entry.name.startsWith(".")) names.push(entry.name);
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return names;
}

async function describe(directory: string, backup: NewBackup): Promise<BackupMetadata> {
  const files: ApkFile[] = [];
  for await (const entry of Deno.readDir(directory)) {
    if (!entry.isFile || !isApkFileName(entry.name)) continue;
    const path = join(directory, entry.name);
    const { size } = await Deno.stat(path);
    const file = await Deno.open(path); // the readable closes it
    const sha256 = encodeHex(await crypto.subtle.digest("SHA-256", file.readable));
    files.push({ name: entry.name, size, sha256 });
  }
  if (files.length === 0) throw new AppError("adb-failed", "No APK files were copied");
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { formatVersion: 1, ...backup, files };
}

async function readEntry(directory: string): Promise<LibraryEntry | null> {
  let parsed: BackupMetadata;
  try {
    parsed = JSON.parse(await Deno.readTextFile(join(directory, METADATA_FILE)));
  } catch {
    return null;
  }
  const valid = parsed?.formatVersion === 1 && isPackageName(parsed.packageName) &&
    Number.isSafeInteger(parsed.versionCode) && Array.isArray(parsed.files) &&
    parsed.files.every((file) => isApkFileName(file?.name));
  return valid ? { ...parsed, directory } : null;
}
