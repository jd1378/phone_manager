export type DeviceState =
  | "device"
  | "unauthorized"
  | "offline"
  | "no-permissions"
  | "authorizing"
  | "connecting"
  | "recovery"
  | "sideload"
  | "bootloader"
  | "unknown";

export interface Device {
  serial: string;
  state: DeviceState;
  model: string | null;
  product: string | null;
  wireless: boolean;
}

/** A phone announcing wireless debugging on the local network (mDNS). */
export interface DiscoveredService {
  name: string;
  /** "pairing" while the phone shows its "Pair device with pairing code" popup. */
  kind: "pairing" | "connect";
  host: string;
  port: number;
}

export interface DeviceUser {
  id: number;
  name: string;
  running: boolean;
}

export interface DeviceInfo {
  serial: string;
  manufacturer: string;
  model: string;
  androidVersion: string;
  sdk: number;
  abis: string[];
  batteryLevel: number | null;
  storage: { totalBytes: number; freeBytes: number } | null;
  users: DeviceUser[];
}

/** What `pm list packages` reports; always available. */
export interface AppSummary {
  packageName: string;
  versionCode: number;
  uid: number | null;
  installer: string | null;
  apkPath: string;
  system: boolean;
  enabled: boolean;
  /** False when uninstalled for this user but data or APK is kept (uninstall -k, other users). */
  installed: boolean;
}

/** What the phone helper reports; loaded on demand. */
export interface AppMetadata {
  label: string;
  versionName: string | null;
  minSdk: number | null;
  targetSdk: number;
  firstInstallTime: number;
  lastUpdateTime: number;
  updatedSystem: boolean;
  debuggable: boolean;
  splitCount: number;
  launchable: boolean;
  hasIcon: boolean;
  permissions: string[];
  grantedRuntimePermissions: string[];
}

export interface AppSizes {
  appBytes: number;
  dataBytes: number;
  cacheBytes: number;
}

export interface App extends AppSummary {
  metadata: AppMetadata | null;
  sizes: AppSizes | null;
}

export interface AppPermission {
  name: string;
  granted: boolean;
  /** Only runtime (dangerous) permissions can be granted or revoked. */
  runtime: boolean;
}

export interface AppDetails {
  packageName: string;
  versionCode: number;
  metadata: AppMetadata;
  uid: number;
  installer: string | null;
  dataDir: string | null;
  apkPaths: string[];
  signers: string[];
  permissions: AppPermission[];
}

export type AppAction =
  | "launch"
  | "force-stop"
  | "open-settings"
  | "enable"
  | "disable"
  | "clear-data"
  | "uninstall"
  | "uninstall-keep-data"
  | "reinstall-existing";

export interface ApkFile {
  name: string;
  size: number;
  sha256: string;
}

/** Contents of metadata.json next to backed up APKs. */
export interface BackupMetadata {
  formatVersion: 1;
  packageName: string;
  versionCode: number;
  versionName: string | null;
  label: string | null;
  minSdk: number | null;
  targetSdk: number | null;
  signers: string[];
  installer: string | null;
  files: ApkFile[];
  backedUpAt: string;
  source: { model: string | null; androidVersion: string | null };
}

export interface LibraryEntry extends BackupMetadata {
  directory: string;
}

export interface ApkManifest {
  packageName: string;
  versionCode: number;
  versionName: string | null;
  /** Split name; null for a base APK. */
  split: string | null;
  minSdk: number | null;
}

export interface InspectedApk {
  fileName: string;
  path: string;
  size: number;
  manifest: ApkManifest | null;
}

export interface Upload {
  id: string;
  name: string;
  size: number;
  apks: InspectedApk[];
}

export interface InstallOptions {
  user: number;
  grantPermissions: boolean;
  allowDowngrade: boolean;
}

export interface Settings {
  backupDirectory: string;
  autoLoadMetadata: boolean;
}

export interface LogLine {
  time: string;
  pid: number;
  tid: number;
  level: "V" | "D" | "I" | "W" | "E" | "F" | "S";
  tag: string;
  message: string;
}

export interface ProgressUpdate {
  done: number;
  total: number;
  message: string;
}

export interface ItemResult {
  item: string;
  ok: boolean;
  message: string;
}
