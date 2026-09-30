import type { InspectedApk, LibraryEntry } from "./models.ts";

export type InstallWarning =
  | { kind: "downgrade"; installedVersionCode: number }
  | { kind: "reinstall" }
  | { kind: "min-sdk"; minSdk: number; deviceSdk: number }
  | { kind: "signer-mismatch" }
  | { kind: "missing-base" }
  | { kind: "unreadable"; fileName: string };

export interface InstallFile {
  name: string;
  path: string;
  size: number;
}

export interface InstallGroup {
  packageName: string | null;
  label: string | null;
  versionCode: number | null;
  versionName: string | null;
  minSdk: number | null;
  signers: string[];
  files: InstallFile[];
  warnings: InstallWarning[];
}

export interface InstalledPackage {
  versionCode: number;
  /** Empty when unknown. */
  signers: string[];
}

export interface DeviceContext {
  sdk: number;
  installed: ReadonlyMap<string, InstalledPackage>;
}

/**
 * Groups loose APKs into installable sets: one group per package and version (base plus splits).
 * APKs whose manifest could not be read are installed on their own and left for adb to judge.
 */
export function groupApks(apks: readonly InspectedApk[]): InstallGroup[] {
  const groups = new Map<string, InstallGroup>();
  const loose: InstallGroup[] = [];
  for (const apk of apks) {
    const file = { name: apk.fileName, path: apk.path, size: apk.size };
    const manifest = apk.manifest;
    if (!manifest) {
      loose.push({
        packageName: null,
        label: null,
        versionCode: null,
        versionName: null,
        minSdk: null,
        signers: [],
        files: [file],
        warnings: [{ kind: "unreadable", fileName: apk.fileName }],
      });
      continue;
    }
    const key = `${manifest.packageName}@${manifest.versionCode}`;
    const group = groups.get(key) ?? {
      packageName: manifest.packageName,
      label: null,
      versionCode: manifest.versionCode,
      versionName: null,
      minSdk: null,
      signers: [],
      files: [],
      warnings: [],
    };
    if (manifest.split === null) {
      group.versionName = manifest.versionName;
      group.minSdk = manifest.minSdk;
      group.files.unshift(file);
    } else {
      group.files.push(file);
    }
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const hasBase = apks.some((apk) =>
      apk.manifest?.packageName === group.packageName && apk.manifest?.versionCode === group.versionCode &&
      apk.manifest?.split === null
    );
    if (!hasBase) group.warnings.push({ kind: "missing-base" });
  }
  return [...groups.values(), ...loose];
}

export function libraryGroup(entry: LibraryEntry, pathOf: (fileName: string) => string): InstallGroup {
  // Base first: adb install-multiple accepts any order, but it keeps the plan readable.
  const files = [...entry.files].sort((a, b) => (a.name === "base.apk" ? -1 : b.name === "base.apk" ? 1 : 0));
  return {
    packageName: entry.packageName,
    label: entry.label,
    versionCode: entry.versionCode,
    versionName: entry.versionName,
    minSdk: entry.minSdk,
    signers: entry.signers,
    files: files.map((file) => ({ name: file.name, path: pathOf(file.name), size: file.size })),
    warnings: [],
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value) => b.includes(value));

export function withWarnings(group: InstallGroup, device: DeviceContext): InstallGroup {
  const warnings = [...group.warnings];
  if (group.minSdk !== null && group.minSdk > device.sdk) {
    warnings.push({ kind: "min-sdk", minSdk: group.minSdk, deviceSdk: device.sdk });
  }
  const installed = group.packageName ? device.installed.get(group.packageName) : undefined;
  if (installed && group.versionCode !== null) {
    if (group.versionCode < installed.versionCode) {
      warnings.push({ kind: "downgrade", installedVersionCode: installed.versionCode });
    } else if (group.versionCode === installed.versionCode) {
      warnings.push({ kind: "reinstall" });
    }
    if (
      group.signers.length > 0 && installed.signers.length > 0 && !sameSet(group.signers, installed.signers)
    ) {
      warnings.push({ kind: "signer-mismatch" });
    }
  }
  return { ...group, warnings };
}
