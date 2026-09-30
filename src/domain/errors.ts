export type ErrorCode =
  | "invalid-input"
  | "not-found"
  | "device-unavailable"
  | "adb-failed"
  | "install-failed"
  | "helper-failed";

export class AppError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly detail?: string) {
    super(message);
    this.name = "AppError";
  }
}
