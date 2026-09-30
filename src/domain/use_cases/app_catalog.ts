import type { DebloatList } from "../debloat.ts";
import type { App, AppSizes } from "../models.ts";
import type { HelperApp, PackageGateway } from "../ports.ts";

export const ICON_SIZE_PX = 96;

/**
 * App lists come from `pm` (fast, always works). Labels, icons and sizes come from the phone helper
 * on request and are kept per device, reused while an app's version code is unchanged.
 */
export class AppCatalog {
  readonly #metadata = new Map<string, Map<string, HelperApp>>();
  readonly #sizes = new Map<string, Map<string, AppSizes>>();

  constructor(
    private readonly packages: PackageGateway,
    private readonly hints: { current(): Promise<DebloatList | null> } = {
      current: () => Promise.resolve(null),
    },
  ) {}

  hasMetadata(serial: string): boolean {
    return this.#metadata.has(serial);
  }

  async list(serial: string, user: number): Promise<App[]> {
    const [summaries, debloat] = await Promise.all([
      this.packages.list(serial, user),
      this.hints.current().catch(() => null),
    ]);
    const metadata = this.#metadata.get(serial);
    const sizes = this.#sizes.get(`${serial}/${user}`);
    return summaries.map((summary) => {
      const known = metadata?.get(summary.packageName);
      return {
        ...summary,
        metadata: known && known.versionCode === summary.versionCode ? known.metadata : null,
        sizes: sizes?.get(summary.packageName) ?? null,
        debloat: debloat?.entries.get(summary.packageName) ?? null,
      };
    });
  }

  /** Runs the phone helper. Sizes are best effort: a failure there leaves them empty. */
  async loadMetadata(serial: string, user: number): Promise<App[]> {
    const [apps, sizes] = await Promise.all([
      this.packages.metadata(serial, ICON_SIZE_PX),
      this.packages.sizes(serial, user).catch(() => new Map<string, AppSizes>()),
    ]);
    this.#metadata.set(serial, new Map(apps.map((app) => [app.packageName, app])));
    this.#sizes.set(`${serial}/${user}`, sizes);
    return this.list(serial, user);
  }

  icon(serial: string, packageName: string): Uint8Array<ArrayBuffer> | null {
    return this.#metadata.get(serial)?.get(packageName)?.icon ?? null;
  }
}
