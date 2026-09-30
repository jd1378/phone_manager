import type { InstallFailure } from "./install_failure.ts";
import type {
  AppAction,
  AppDetails,
  AppMetadata,
  AppSizes,
  AppSummary,
  BackupMetadata,
  Device,
  DeviceInfo,
  InstallOptions,
  LibraryEntry,
  LogLine,
  Settings,
  Upload,
} from "./models.ts";

export interface DeviceRegistry {
  list(): Promise<Device[]>;
  info(serial: string): Promise<DeviceInfo>;
  /** Calls onChange whenever devices may have connected, disconnected or changed state. */
  watch(onChange: () => void, signal: AbortSignal): void;
  pair(host: string, port: number, code: string): Promise<string>;
  connect(host: string, port: number): Promise<string>;
  disconnect(serial: string): Promise<void>;
}

export interface HelperApp {
  packageName: string;
  versionCode: number;
  metadata: AppMetadata;
  icon: Uint8Array<ArrayBuffer> | null;
}

export interface PackageGateway {
  list(serial: string, user: number): Promise<AppSummary[]>;
  metadata(serial: string, iconSize: number): Promise<HelperApp[]>;
  sizes(serial: string, user: number): Promise<Map<string, AppSizes>>;
  details(serial: string, packageName: string): Promise<AppDetails>;
  apkPaths(serial: string, packageName: string, user: number): Promise<string[]>;
  pull(serial: string, remotePath: string, localPath: string): Promise<void>;
  /** Resolves to null on success. */
  install(serial: string, localPaths: string[], options: InstallOptions): Promise<InstallFailure | null>;
  act(serial: string, packageName: string, user: number, action: AppAction): Promise<void>;
  setPermission(
    serial: string,
    packageName: string,
    user: number,
    permission: string,
    granted: boolean,
  ): Promise<void>;
}

export interface LogSource {
  lines(serial: string, signal: AbortSignal): AsyncIterable<LogLine>;
  /** PIDs of the package's processes, including ones like com.app:remote. */
  processIds(serial: string, packageName: string): Promise<number[]>;
}

export type NewBackup = Omit<BackupMetadata, "formatVersion" | "files">;

export interface StagedBackup {
  /** Local path to write a file into; rejects unsafe names. */
  pathFor(fileName: string): string;
  /** Hashes the staged files and publishes the backup atomically. */
  commit(metadata: NewBackup): Promise<LibraryEntry>;
  abort(): Promise<void>;
}

export interface BackupLibrary {
  list(): Promise<LibraryEntry[]>;
  get(packageName: string, versionCode: number): Promise<LibraryEntry | null>;
  stage(packageName: string, versionCode: number): Promise<StagedBackup>;
  filePath(entry: LibraryEntry, fileName: string): string;
  remove(packageName: string, versionCode: number): Promise<void>;
}

export interface SettingsStore {
  get(): Promise<Settings>;
  update(patch: Partial<Settings>): Promise<Settings>;
}

export interface UploadStore {
  save(name: string, body: ReadableStream<Uint8Array>): Promise<Upload>;
  get(id: string): Upload | null;
  remove(id: string): Promise<void>;
}

export interface DirectoryListing {
  path: string;
  parent: string | null;
  directories: string[];
}

export interface DirectoryBrowser {
  home(): string;
  list(path: string): Promise<DirectoryListing>;
  create(path: string): Promise<void>;
}
