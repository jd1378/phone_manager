import type { AppAction, ItemResult, ProgressUpdate } from "../models.ts";
import type { PackageGateway } from "../ports.ts";
import { errorMessage } from "./backup.ts";

export const BATCH_ACTIONS = ["enable", "disable", "uninstall", "uninstall-keep-data", "force-stop"] as const;
export type BatchAction = typeof BATCH_ACTIONS[number];

export const isBatchAction = (value: unknown): value is BatchAction =>
  (BATCH_ACTIONS as readonly unknown[]).includes(value);

export async function runBatch(
  packages: PackageGateway,
  serial: string,
  user: number,
  action: AppAction,
  packageNames: readonly string[],
  onProgress: (update: ProgressUpdate) => void,
): Promise<ItemResult[]> {
  const results: ItemResult[] = [];
  for (const [index, packageName] of packageNames.entries()) {
    onProgress({ done: index, total: packageNames.length, message: packageName });
    try {
      await packages.act(serial, packageName, user, action);
      results.push({ item: packageName, ok: true, message: "Done" });
    } catch (error) {
      results.push({ item: packageName, ok: false, message: errorMessage(error) });
    }
  }
  onProgress({ done: packageNames.length, total: packageNames.length, message: "Finished" });
  return results;
}
