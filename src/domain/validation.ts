import { AppError } from "./errors.ts";

// Each segment starts with a letter (Android's own rule). Keeps names safe to embed in a device shell command.
const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/;
const PERMISSION_NAME = /^[A-Za-z][A-Za-z0-9_.]*$/;
const APK_FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\.apk$/;
// USB serials, emulator-5554, host:port, mDNS service names.
const SERIAL = /^[A-Za-z0-9_.:\[\]%@-]+$/;
const HOST = /^(\[[0-9A-Fa-f:.%a-z]+\]|[A-Za-z0-9.-]+)$/;
const PAIRING_CODE = /^\d{6}$/;

export const isPackageName = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 255 && PACKAGE_NAME.test(value);

export const isPermissionName = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 255 && PERMISSION_NAME.test(value);

export const isApkFileName = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 255 && APK_FILE_NAME.test(value) && !value.includes("..");

export const isSerial = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 255 && !value.startsWith("-") && SERIAL.test(value);

export const isUserId = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 100_000;

export const isHost = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 255 && !value.startsWith("-") && HOST.test(value);

export const isPort = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value < 65536;

export const isPairingCode = (value: unknown): value is string =>
  typeof value === "string" && PAIRING_CODE.test(value);

export function requireValid<T>(check: (value: unknown) => value is T, value: unknown, what: string): T {
  if (!check(value)) throw new AppError("invalid-input", `Invalid ${what}: ${String(value).slice(0, 80)}`);
  return value;
}

/** File name of a path on the phone, e.g. /data/app/~~x==/com.a-y==/split_config.en.apk */
export function remoteApkFileName(remotePath: string): string {
  const name = remotePath.slice(remotePath.lastIndexOf("/") + 1);
  return requireValid(isApkFileName, name, "APK file name");
}
