import type { DebloatEntry, DebloatList } from "../src/domain/debloat.ts";
import type { AppDetails, AppMetadata, AppSummary, DeviceInfo, LibraryEntry } from "../src/domain/models.ts";
import type {
  BackupLibrary,
  DebloatSource,
  DeviceRegistry,
  PackageGateway,
  StagedBackup,
} from "../src/domain/ports.ts";

export function summary(packageName: string, patch: Partial<AppSummary> = {}): AppSummary {
  return {
    packageName,
    versionCode: 1,
    uid: 10001,
    installer: "com.android.vending",
    apkPath: `/data/app/${packageName}/base.apk`,
    system: false,
    enabled: true,
    installed: true,
    ...patch,
  };
}

export function metadata(label: string, patch: Partial<AppMetadata> = {}): AppMetadata {
  return {
    label,
    versionName: "1.0",
    minSdk: 21,
    targetSdk: 34,
    firstInstallTime: 1_000,
    lastUpdateTime: 2_000,
    updatedSystem: false,
    debuggable: false,
    splitCount: 0,
    launchable: true,
    hasIcon: false,
    permissions: [],
    grantedRuntimePermissions: [],
    ...patch,
  };
}

export function details(packageName: string, patch: Partial<AppDetails> = {}): AppDetails {
  return {
    packageName,
    versionCode: 1,
    metadata: metadata(packageName),
    uid: 10001,
    installer: null,
    dataDir: null,
    apkPaths: [],
    signers: ["aa"],
    permissions: [],
    ...patch,
  };
}

const unused = () => Promise.reject(new Error("not used in this test"));

export function fakePackages(overrides: Partial<PackageGateway> = {}): PackageGateway {
  return {
    list: unused,
    metadata: unused,
    sizes: unused,
    details: unused,
    apkPaths: unused,
    pull: unused,
    install: unused,
    act: unused,
    setPermission: unused,
    ...overrides,
  };
}

export const deviceInfo: DeviceInfo = {
  serial: "S1",
  manufacturer: "Acme",
  model: "Phone",
  androidVersion: "14",
  sdk: 34,
  abis: ["arm64-v8a"],
  batteryLevel: 50,
  storage: null,
  users: [{ id: 0, name: "Owner", running: true }],
};

export function fakeDevices(overrides: Partial<DeviceRegistry> = {}): DeviceRegistry {
  return {
    list: () => Promise.resolve([]),
    info: () => Promise.resolve(deviceInfo),
    watch: () => {},
    discover: () => Promise.resolve([]),
    pair: unused,
    connect: unused,
    disconnect: unused,
    ...overrides,
  };
}

/** In-memory library that records what was staged and committed. */
export class MemoryLibrary implements BackupLibrary {
  entries: LibraryEntry[] = [];
  written: string[] = [];
  aborted = 0;

  list() {
    return Promise.resolve(this.entries);
  }
  get(packageName: string, versionCode: number) {
    return Promise.resolve(
      this.entries.find((e) => e.packageName === packageName && e.versionCode === versionCode) ?? null,
    );
  }
  stage(packageName: string, versionCode: number): Promise<StagedBackup> {
    const dir = `/lib/${packageName}/${versionCode}`;
    const files: string[] = [];
    return Promise.resolve({
      pathFor: (name) => {
        files.push(name);
        return `${dir}/${name}`;
      },
      commit: (backup) => {
        const entry: LibraryEntry = {
          formatVersion: 1,
          ...backup,
          files: files.map((name) => ({ name, size: 1, sha256: "00" })),
          directory: dir,
        };
        this.entries.push(entry);
        return Promise.resolve(entry);
      },
      abort: () => {
        this.aborted++;
        return Promise.resolve();
      },
    });
  }
  filePath(entry: LibraryEntry, name: string) {
    return `${entry.directory}/${name}`;
  }
  remove() {
    return Promise.resolve();
  }
}

export function debloatEntry(patch: Partial<DebloatEntry> = {}): DebloatEntry {
  return {
    level: "recommended",
    category: "oem",
    description: "",
    dependencies: [],
    neededBy: [],
    tracking: null,
    ...patch,
  };
}

export function debloatList(
  entries: Record<string, DebloatEntry>,
  updatedAt = new Date().toISOString(),
): DebloatList {
  return {
    entries: new Map(Object.entries(entries)),
    updatedAt,
    source: { name: "Test list", url: "https://example.test", license: "GPL-3.0" },
  };
}

export function fakeDebloatSource(overrides: Partial<DebloatSource> = {}): DebloatSource {
  return {
    info: { name: "Test list", url: "https://example.test", license: "GPL-3.0" },
    cached: () => Promise.resolve(null),
    download: () => Promise.reject(new Error("offline")),
    ...overrides,
  };
}
