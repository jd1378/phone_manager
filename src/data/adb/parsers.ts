import type {
  AppDetails,
  AppMetadata,
  AppPermission,
  AppSizes,
  Device,
  DeviceState,
  DeviceUser,
  DiscoveredService,
  LogLine,
} from "../../domain/models.ts";
import type { HelperApp } from "../../domain/ports.ts";
import { decodeBase64 } from "@std/encoding/base64";

const lines = (output: string) => output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

const STATES: Record<string, DeviceState> = {
  device: "device",
  unauthorized: "unauthorized",
  offline: "offline",
  authorizing: "authorizing",
  connecting: "connecting",
  recovery: "recovery",
  sideload: "sideload",
  bootloader: "bootloader",
};

/** `adb devices -l` */
export function parseDevices(output: string): Device[] {
  const devices: Device[] = [];
  for (const line of lines(output)) {
    if (line.startsWith("List of devices") || line.startsWith("*")) continue;
    const match = line.match(/^(\S+)\s+(no permissions|\S+)(.*)$/);
    if (!match) continue;
    const [, serial, rawState, rest] = match;
    const field = (key: string) => rest.match(new RegExp(`(?:^|\\s)${key}:(\\S+)`))?.[1] ?? null;
    devices.push({
      serial,
      state: rawState === "no permissions" ? "no-permissions" : STATES[rawState] ?? "unknown",
      model: field("model")?.replaceAll("_", " ") ?? null,
      product: field("product"),
      wireless: serial.includes(":") || serial.includes("._adb-tls-"),
    });
  }
  return devices;
}

export interface PackageLine {
  packageName: string;
  apkPath: string;
  versionCode: number;
  uid: number | null;
  installer: string | null;
}

/** `adb mdns services`, e.g. "adb-6PO7LJ-HmopAu\t_adb-tls-connect._tcp\t192.168.8.12:33083" */
export function parseMdnsServices(output: string): DiscoveredService[] {
  const services: DiscoveredService[] = [];
  for (const line of lines(output)) {
    const match = line.match(/^(\S+)\s+_adb-tls-(pairing|connect)\._tcp\.?\s+(\S+)$/);
    if (!match) continue;
    const address = match[3];
    const colon = address.lastIndexOf(":");
    const port = Number(address.slice(colon + 1));
    if (colon <= 0 || !Number.isInteger(port)) continue;
    services.push({
      name: match[1],
      kind: match[2] as DiscoveredService["kind"],
      host: address.slice(0, colon).replace(/^\[|\]$/g, ""),
      port,
    });
  }
  return services;
}

/** `pm list packages -f -U -i --show-versioncode`; field order varies between Android versions. */
export function parsePackageList(output: string): PackageLine[] {
  const result: PackageLine[] = [];
  for (const line of lines(output)) {
    if (!line.startsWith("package:")) continue;
    const [pathAndName, ...fields] = line.slice("package:".length).split(/\s+/);
    // APK paths contain '=' (base64 padding); the package name follows the last one.
    const split = pathAndName.lastIndexOf("=");
    const values = new Map(
      fields.map((field) => {
        const match = field.match(/^([A-Za-z]+)[:=](.*)$/);
        return match ? [match[1], match[2]] as const : ["", ""] as const;
      }),
    );
    const installer = values.get("installer");
    result.push({
      packageName: split >= 0 ? pathAndName.slice(split + 1) : pathAndName,
      apkPath: split >= 0 ? pathAndName.slice(0, split) : "",
      versionCode: Number(values.get("versionCode") ?? 0),
      uid: values.has("uid") ? Number(values.get("uid")) : null,
      installer: installer && installer !== "null" ? installer : null,
    });
  }
  return result;
}

/** `pm list packages` without -f */
export function parsePackageNames(output: string): Set<string> {
  return new Set(lines(output).filter((l) => l.startsWith("package:")).map((l) => l.slice(8).split(/\s/)[0]));
}

/** `pm path` */
export function parsePmPath(output: string): string[] {
  return lines(output).filter((l) => l.startsWith("package:")).map((l) => l.slice(8));
}

/** `pm list users`, e.g. "UserInfo{0:Owner:c13} running" */
export function parseUsers(output: string): DeviceUser[] {
  const users: DeviceUser[] = [];
  for (const line of lines(output)) {
    const match = line.match(/UserInfo\{(\d+):(.*):[0-9a-fA-F]+\}(\s+running)?/);
    if (match) users.push({ id: Number(match[1]), name: match[2], running: Boolean(match[3]) });
  }
  return users;
}

export function parseBatteryLevel(output: string): number | null {
  const match = output.match(/^\s*level:\s*(\d+)/m);
  return match ? Number(match[1]) : null;
}

/** `df /data` in 1K blocks */
export function parseDf(output: string): { totalBytes: number; freeBytes: number } | null {
  const row = lines(output).find((line) => !line.startsWith("Filesystem"));
  const numbers = row?.split(/\s+/).slice(1, 4).map(Number);
  if (!numbers || numbers.length < 3 || numbers.some(Number.isNaN)) return null;
  return { totalBytes: numbers[0] * 1024, freeBytes: numbers[2] * 1024 };
}

/** `ps -A -o PID,NAME`: the package's own processes, including "pkg:service" ones. */
export function parseProcessIds(output: string, packageName: string): number[] {
  const pids: number[] = [];
  for (const line of lines(output)) {
    const match = line.match(/^(\d+)\s+(\S+)$/);
    if (match && (match[2] === packageName || match[2].startsWith(`${packageName}:`))) {
      pids.push(Number(match[1]));
    }
  }
  return pids;
}

const LOGCAT_LINE = /^(\d\d-\d\d\s+\d\d:\d\d:\d\d\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEFS])\s+(.*?)\s*: ?(.*)$/;

/** `logcat -v threadtime` */
export function parseLogcatLine(line: string): LogLine | null {
  const match = line.match(LOGCAT_LINE);
  if (!match) return null;
  return {
    time: match[1],
    pid: Number(match[2]),
    tid: Number(match[3]),
    level: match[4] as LogLine["level"],
    tag: match[5],
    message: match[6],
  };
}

// deno-lint-ignore no-explicit-any
type Json = any;

function metadataFrom(json: Json, hasIcon: boolean): AppMetadata {
  return {
    label: String(json.label ?? json.packageName),
    versionName: json.versionName ?? null,
    minSdk: typeof json.minSdk === "number" ? json.minSdk : null,
    targetSdk: Number(json.targetSdk ?? 0),
    firstInstallTime: Number(json.firstInstallTime ?? 0),
    lastUpdateTime: Number(json.lastUpdateTime ?? 0),
    updatedSystem: Boolean(json.updatedSystem),
    debuggable: Boolean(json.debuggable),
    splitCount: Number(json.splitCount ?? 0),
    launchable: Boolean(json.launchable),
    hasIcon,
    permissions: Array.isArray(json.permissions) ? json.permissions.map(String) : [],
    grantedRuntimePermissions: Array.isArray(json.grantedRuntimePermissions)
      ? json.grantedRuntimePermissions.map(String)
      : [],
  };
}

function jsonLines(output: string): Json[] {
  return lines(output).filter((line) => line.startsWith("{")).map((line) => JSON.parse(line));
}

/** Phone helper `list` output. */
export function parseHelperList(output: string): HelperApp[] {
  return jsonLines(output).map((json) => {
    const icon = typeof json.icon === "string" ? decodeBase64(json.icon) : null;
    return {
      packageName: String(json.packageName),
      versionCode: Number(json.versionCode),
      metadata: metadataFrom(json, icon !== null),
      icon,
    };
  });
}

/** Phone helper `info` output. */
export function parseHelperInfo(output: string): AppDetails {
  const json = jsonLines(output)[0];
  if (!json) throw new Error("Phone helper returned no data");
  const permissions: AppPermission[] = (json.permissionDetails ?? []).map((p: Json) => ({
    name: String(p.name),
    granted: Boolean(p.granted),
    runtime: Boolean(p.runtime),
  }));
  return {
    packageName: String(json.packageName),
    versionCode: Number(json.versionCode),
    metadata: metadataFrom(json, false),
    uid: Number(json.uid),
    installer: json.installer ?? null,
    dataDir: json.dataDir ?? null,
    apkPaths: (json.apkPaths ?? []).map(String),
    signers: (json.signers ?? []).map(String),
    permissions,
  };
}

/** Phone helper `sizes` output. */
export function parseHelperSizes(output: string): Map<string, AppSizes> {
  return new Map(
    jsonLines(output).map((json) => [
      String(json.packageName),
      {
        appBytes: Number(json.appBytes),
        dataBytes: Number(json.dataBytes),
        cacheBytes: Number(json.cacheBytes),
      },
    ]),
  );
}
