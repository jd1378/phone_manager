import type { DebloatStatus } from "../../domain/debloat.ts";
import type { InstallGroup } from "../../domain/install_plan.ts";
import type {
  App,
  AppAction,
  AppDetails,
  Device,
  DeviceInfo,
  DiscoveredService,
  LibraryEntry,
  Settings,
  Upload,
} from "../../domain/models.ts";
import type { DirectoryListing } from "../../domain/ports.ts";
import type { Job } from "../http/jobs.ts";

export type { Job };
export type PublicGroup = Omit<InstallGroup, "files"> & { files: { name: string; size: number }[] };
export type PublicUpload = Omit<Upload, "apks"> & { apks: Omit<Upload["apks"][number], "path">[] };
export interface LibraryPick {
  packageName: string;
  versionCode: number;
}
export interface InstallChoice {
  uploads: string[];
  library: LibraryPick[];
}

export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly detail: string | null = null) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      data?.error?.message ?? `Request failed (${response.status})`,
      data?.error?.code ?? "http",
      data?.error?.detail ?? null,
    );
  }
  return data as T;
}

const device = (serial: string) => `/api/devices/${encodeURIComponent(serial)}`;
const app = (serial: string, packageName: string) => `${device(serial)}/apps/${packageName}`;

export interface AppsResponse {
  apps: App[];
  metadataLoaded: boolean;
}

export const api = {
  state: () =>
    request<
      {
        devices: Device[];
        settings: Settings;
        jobs: Job[];
        adbVersion: string;
        home: string;
        debloat: DebloatStatus;
      }
    >(
      "GET",
      "/api/state",
    ),
  deviceInfo: (serial: string) => request<DeviceInfo>("GET", device(serial)),
  apps: (serial: string, user: number) => request<AppsResponse>("GET", `${device(serial)}/apps?user=${user}`),
  loadMetadata: (serial: string, user: number) =>
    request<AppsResponse>("POST", `${device(serial)}/apps/metadata`, { user }),
  details: (serial: string, packageName: string) => request<AppDetails>("GET", app(serial, packageName)),
  action: (serial: string, packageName: string, action: AppAction, user: number) =>
    request("POST", `${app(serial, packageName)}/action`, { action, user }),
  permission: (serial: string, packageName: string, permission: string, granted: boolean, user: number) =>
    request("POST", `${app(serial, packageName)}/permission`, { permission, granted, user }),
  batch: (serial: string, action: string, packages: string[], user: number) =>
    request<Job>("POST", `${device(serial)}/batch`, { action, packages, user }),
  backup: (serial: string, packages: string[], user: number) =>
    request<Job>("POST", `${device(serial)}/backup`, { packages, user }),
  installPlan: (serial: string, choice: InstallChoice, user: number) =>
    request<PublicGroup[]>("POST", `${device(serial)}/install/plan`, { ...choice, user }),
  install: (
    serial: string,
    choice: InstallChoice,
    options: { user: number; grantPermissions: boolean; allowDowngrade: boolean },
  ) => request<Job>("POST", `${device(serial)}/install`, { ...choice, ...options }),
  deleteUpload: (id: string) => request("DELETE", `/api/uploads/${id}`),
  library: () => request<LibraryEntry[]>("GET", "/api/library"),
  deleteBackup: (entry: LibraryPick) =>
    request("DELETE", `/api/library/${entry.packageName}/${entry.versionCode}`),
  updateDebloat: () => request<DebloatStatus>("POST", "/api/debloat/update"),
  saveSettings: (patch: Partial<Settings>) => request<Settings>("PUT", "/api/settings", patch),
  directories: (path: string) =>
    request<DirectoryListing>("GET", `/api/fs/dirs?path=${encodeURIComponent(path)}`),
  createDirectory: (path: string) => request("POST", "/api/fs/dirs", { path }),
  discover: () => request<DiscoveredService[]>("GET", "/api/adb/discover"),
  pair: (host: string, port: number, code: string) =>
    request<{ message: string }>("POST", "/api/adb/pair", { host, port, code }),
  connect: (host: string, port: number) =>
    request<{ message: string }>("POST", "/api/adb/connect", { host, port }),
  disconnect: (serial: string) => request("POST", "/api/adb/disconnect", { serial }),
  iconUrl: (serial: string, packageName: string, versionCode: number) =>
    `${device(serial)}/icons/${packageName}?v=${versionCode}`,
  logcatUrl: (serial: string, packageName: string) => `${device(serial)}/logcat?package=${packageName}`,

  /** XHR because fetch cannot report upload progress. */
  upload(file: File, onProgress: (fraction: number) => void): Promise<PublicUpload> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `/api/uploads?name=${encodeURIComponent(file.name)}`);
      xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
      xhr.onerror = () => reject(new ApiError("Upload failed; is Phone Manager still running?", "network"));
      xhr.onload = () => {
        let data;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          data = null;
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else {reject(
            new ApiError(
              data?.error?.message ?? `Upload failed (${xhr.status})`,
              data?.error?.code ?? "http",
            ),
          );}
      };
      xhr.send(file);
    });
  },
};
