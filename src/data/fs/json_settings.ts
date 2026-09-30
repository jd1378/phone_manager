import { dirname, isAbsolute, join } from "@std/path";
import { AppError } from "../../domain/errors.ts";
import type { Settings } from "../../domain/models.ts";
import type { SettingsStore } from "../../domain/ports.ts";

export class JsonSettingsStore implements SettingsStore {
  #cache: Settings | null = null;
  #writing: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string, private readonly defaults: Settings) {}

  async get(): Promise<Settings> {
    if (this.#cache) return this.#cache;
    let stored: Partial<Settings> = {};
    try {
      stored = JSON.parse(await Deno.readTextFile(this.path));
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        console.warn(`Ignoring unreadable settings at ${this.path}: ${error}`);
      }
    }
    this.#cache = sanitize(stored, this.defaults);
    return this.#cache;
  }

  /** Validates, creates the backup directory, then writes atomically. Updates run one at a time. */
  update(patch: Partial<Settings>): Promise<Settings> {
    const next = this.#writing.then(async () => {
      const current = await this.get();
      const updated: Settings = { ...current };
      if (patch.backupDirectory !== undefined) {
        if (typeof patch.backupDirectory !== "string" || !isAbsolute(patch.backupDirectory)) {
          throw new AppError("invalid-input", "Backup folder must be an absolute path");
        }
        try {
          await Deno.mkdir(patch.backupDirectory, { recursive: true });
        } catch (error) {
          throw new AppError(
            "invalid-input",
            `Cannot use ${patch.backupDirectory}: ${(error as Error).message}`,
          );
        }
        updated.backupDirectory = patch.backupDirectory;
      }
      if (patch.autoLoadMetadata !== undefined) updated.autoLoadMetadata = patch.autoLoadMetadata === true;
      if (patch.bloatwareHints !== undefined) updated.bloatwareHints = patch.bloatwareHints === true;
      await Deno.mkdir(dirname(this.path), { recursive: true });
      const temp = join(dirname(this.path), `.settings-${crypto.randomUUID()}.json`);
      await Deno.writeTextFile(temp, JSON.stringify(updated, null, 2) + "\n", { mode: 0o600 });
      await Deno.rename(temp, this.path);
      this.#cache = updated;
      return updated;
    });
    this.#writing = next.catch(() => {});
    return next;
  }
}

function sanitize(stored: Partial<Settings>, defaults: Settings): Settings {
  return {
    backupDirectory: typeof stored.backupDirectory === "string" && isAbsolute(stored.backupDirectory)
      ? stored.backupDirectory
      : defaults.backupDirectory,
    autoLoadMetadata: typeof stored.autoLoadMetadata === "boolean"
      ? stored.autoLoadMetadata
      : defaults.autoLoadMetadata,
    bloatwareHints: typeof stored.bloatwareHints === "boolean"
      ? stored.bloatwareHints
      : defaults.bloatwareHints,
  };
}
