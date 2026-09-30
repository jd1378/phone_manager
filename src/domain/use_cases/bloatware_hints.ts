import type { DebloatList, DebloatStatus } from "../debloat.ts";
import type { DebloatSource, SettingsStore } from "../ports.ts";
import { errorMessage } from "./backup.ts";

export const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const RETRY_AFTER_MS = 60 * 60 * 1000;

/**
 * Serves the bloatware list when the user has turned hints on. Reading it never waits for the
 * network: a missing or week-old list is downloaded in the background and listeners hear about it.
 */
export class BloatwareHints {
  #list: DebloatList | null = null;
  #loaded = false;
  #updating: Promise<DebloatList> | null = null;
  #failedAt: number | null = null;
  #error: string | null = null;
  readonly #listeners = new Set<() => void>();

  constructor(
    private readonly source: DebloatSource,
    private readonly settings: SettingsStore,
    private readonly now: () => number = Date.now,
  ) {}

  onUpdate(listener: () => void): void {
    this.#listeners.add(listener);
  }

  async current(): Promise<DebloatList | null> {
    if (!(await this.settings.get()).bloatwareHints) return null;
    await this.#loadSaved();
    const stale = !this.#list || this.now() - Date.parse(this.#list.updatedAt) > REFRESH_AFTER_MS;
    const backingOff = this.#failedAt !== null && this.now() - this.#failedAt < RETRY_AFTER_MS;
    if (stale && !backingOff) this.update().catch(() => {});
    return this.#list;
  }

  async #loadSaved(): Promise<void> {
    if (this.#loaded) return;
    this.#list = await this.source.cached().catch(() => null);
    this.#loaded = true;
  }

  /** Downloads now, whatever the age of the saved copy. Concurrent calls share one download. */
  update(): Promise<DebloatList> {
    this.#updating ??= this.source.download()
      .then((list) => {
        this.#list = list;
        this.#loaded = true;
        this.#failedAt = null;
        this.#error = null;
        this.#listeners.forEach((listener) => listener());
        return list;
      }, (error) => {
        this.#failedAt = this.now();
        this.#error = errorMessage(error);
        throw error;
      })
      .finally(() => (this.#updating = null));
    return this.#updating;
  }

  async status(): Promise<DebloatStatus> {
    const enabled = (await this.settings.get()).bloatwareHints;
    if (enabled) await this.#loadSaved();
    return {
      enabled,
      updatedAt: this.#list?.updatedAt ?? null,
      packages: this.#list?.entries.size ?? 0,
      source: this.source.info,
      error: this.#error,
    };
  }
}
