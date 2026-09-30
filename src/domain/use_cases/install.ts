import { AppError } from "../errors.ts";
import {
  type DeviceContext,
  groupApks,
  type InstallGroup,
  libraryGroup,
  withWarnings,
} from "../install_plan.ts";
import type { InstallOptions, ItemResult, ProgressUpdate } from "../models.ts";
import type { BackupLibrary, DeviceRegistry, PackageGateway, UploadStore } from "../ports.ts";
import { errorMessage } from "./backup.ts";

export interface InstallDeps {
  devices: DeviceRegistry;
  packages: PackageGateway;
  library: BackupLibrary;
  uploads: UploadStore;
}

export interface InstallRequest {
  uploadIds: string[];
  library: { packageName: string; versionCode: number }[];
}

/** Turns uploads and library picks into install groups, with warnings about this device. */
export async function planInstall(
  deps: InstallDeps,
  serial: string,
  user: number,
  request: InstallRequest,
): Promise<InstallGroup[]> {
  const apks = request.uploadIds.flatMap((id) => {
    const upload = deps.uploads.get(id);
    if (!upload) throw new AppError("not-found", "Upload expired. Add the file again.");
    return upload.apks;
  });
  const groups = groupApks(apks);
  for (const pick of request.library) {
    const entry = await deps.library.get(pick.packageName, pick.versionCode);
    if (!entry) {
      throw new AppError("not-found", `${pick.packageName} ${pick.versionCode} is not in the library`);
    }
    groups.push(libraryGroup(entry, (name) => deps.library.filePath(entry, name)));
  }
  if (groups.length === 0) throw new AppError("invalid-input", "Nothing to install");

  const [info, summaries] = await Promise.all([deps.devices.info(serial), deps.packages.list(serial, user)]);
  const installedVersions = new Map(
    summaries.filter((s) => s.installed).map((s) => [s.packageName, s.versionCode]),
  );
  const installed: DeviceContext["installed"] = new Map(
    await Promise.all(
      [...installedVersions].map(async ([name, versionCode]) => {
        const needsSigners = groups.some((g) => g.packageName === name && g.signers.length > 0);
        const signers = needsSigners
          ? await deps.packages.details(serial, name).then((d) => d.signers, () => [])
          : [];
        return [name, { versionCode, signers }] as const;
      }),
    ),
  );
  return groups.map((group) => withWarnings(group, { sdk: info.sdk, installed }));
}

export async function installGroups(
  packages: PackageGateway,
  serial: string,
  groups: readonly InstallGroup[],
  options: InstallOptions,
  onProgress: (update: ProgressUpdate) => void,
): Promise<ItemResult[]> {
  const results: ItemResult[] = [];
  for (const [index, group] of groups.entries()) {
    const name = group.label ?? group.packageName ?? group.files[0]?.name ?? "APK";
    onProgress({ done: index, total: groups.length, message: `Installing ${name}` });
    try {
      const failure = await packages.install(serial, group.files.map((file) => file.path), options);
      results.push(
        failure
          ? {
            item: name,
            ok: false,
            message: failure.hint ? `${failure.message}. ${failure.hint}` : failure.message,
          }
          : { item: name, ok: true, message: "Installed" },
      );
    } catch (error) {
      results.push({ item: name, ok: false, message: errorMessage(error) });
    }
  }
  onProgress({ done: groups.length, total: groups.length, message: "Finished" });
  return results;
}
