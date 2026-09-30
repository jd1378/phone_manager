import { AppError } from "../errors.ts";
import type { AppDetails, ItemResult, ProgressUpdate } from "../models.ts";
import type { BackupLibrary, DeviceRegistry, PackageGateway } from "../ports.ts";
import { remoteApkFileName } from "../validation.ts";

export interface BackupDeps {
  devices: DeviceRegistry;
  packages: PackageGateway;
  library: BackupLibrary;
}

/**
 * Copies each app's APKs (base and splits) into the library. Skips versions already backed up,
 * so running it twice is harmless. One app failing does not stop the rest.
 */
export async function backupApps(
  deps: BackupDeps,
  serial: string,
  user: number,
  packageNames: readonly string[],
  onProgress: (update: ProgressUpdate) => void,
): Promise<ItemResult[]> {
  const [summaries, device] = await Promise.all([
    deps.packages.list(serial, user),
    deps.devices.info(serial).catch(() => null),
  ]);
  const byName = new Map(summaries.map((summary) => [summary.packageName, summary]));
  const results: ItemResult[] = [];

  for (const [index, packageName] of packageNames.entries()) {
    onProgress({ done: index, total: packageNames.length, message: `Backing up ${packageName}` });
    try {
      const summary = byName.get(packageName);
      if (!summary) throw new AppError("not-found", "Not installed for this user");
      if (await deps.library.get(packageName, summary.versionCode)) {
        results.push({ item: packageName, ok: true, message: "Already in library" });
        continue;
      }
      const remotePaths = await deps.packages.apkPaths(serial, packageName, user);
      if (remotePaths.length === 0) throw new AppError("not-found", "The phone reported no APK files");
      // Details only add label, signers and SDK levels; a backup without them is still useful.
      const details: AppDetails | null = await deps.packages.details(serial, packageName).catch(() => null);

      const staged = await deps.library.stage(packageName, summary.versionCode);
      try {
        for (const remotePath of remotePaths) {
          await deps.packages.pull(serial, remotePath, staged.pathFor(remoteApkFileName(remotePath)));
        }
        await staged.commit({
          packageName,
          versionCode: summary.versionCode,
          versionName: details?.metadata.versionName ?? null,
          label: details?.metadata.label ?? null,
          minSdk: details?.metadata.minSdk ?? null,
          targetSdk: details?.metadata.targetSdk ?? null,
          signers: details?.signers ?? [],
          installer: summary.installer,
          backedUpAt: new Date().toISOString(),
          source: { model: device?.model ?? null, androidVersion: device?.androidVersion ?? null },
        });
      } catch (error) {
        await staged.abort();
        throw error;
      }
      results.push({
        item: packageName,
        ok: true,
        message: remotePaths.length > 1 ? `Saved ${remotePaths.length} APKs` : "Saved",
      });
    } catch (error) {
      results.push({ item: packageName, ok: false, message: errorMessage(error) });
    }
  }
  onProgress({ done: packageNames.length, total: packageNames.length, message: "Finished" });
  return results;
}

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
