import { join } from "@std/path";
import { AppError } from "../../domain/errors.ts";

export interface AdbResult {
  code: number;
  stdout: string;
  stderr: string;
}

const SHELL_TIMEOUT_MS = 60_000;
const decoder = new TextDecoder();

/**
 * Where to look for adb: PATH first, then the usual SDK and package manager folders. Apps started
 * from a desktop menu do not get the shell's PATH (on macOS they never see Homebrew's).
 */
export function adbCandidates(env: (name: string) => string | undefined, os: string): string[] {
  const home = os === "windows" ? env("USERPROFILE") : env("HOME");
  const localAppData = env("LOCALAPPDATA");
  const sdks = [
    env("ANDROID_HOME"),
    env("ANDROID_SDK_ROOT"),
    os === "windows"
      ? localAppData && join(localAppData, "Android", "Sdk")
      : os === "darwin"
      ? home && join(home, "Library", "Android", "sdk")
      : home && join(home, "Android", "Sdk"),
  ];
  const tool = os === "windows" ? "adb.exe" : "adb";
  const system = os === "darwin"
    ? ["/opt/homebrew/bin/adb", "/usr/local/bin/adb"]
    : os === "linux"
    ? ["/usr/bin/adb", "/usr/local/bin/adb"]
    : [];
  const found = [
    "adb",
    ...sdks.filter((sdk): sdk is string => Boolean(sdk)).map((sdk) => join(sdk, "platform-tools", tool)),
    ...system,
  ];
  return [...new Set(found)];
}

/** Thin wrapper over the adb binary. Arguments are passed as argv, never through a host shell. */
export class Adb {
  constructor(readonly binary = "adb") {}

  /** The first working adb from adbCandidates, or null. */
  static async locate(env: (name: string) => string | undefined, os: string): Promise<Adb | null> {
    for (const candidate of adbCandidates(env, os)) {
      const adb = new Adb(candidate);
      try {
        await adb.version();
        return adb;
      } catch {
        // not installed there
      }
    }
    return null;
  }

  /** Throws when adb is not installed or not runnable. */
  async version(): Promise<string> {
    const result = await this.run(["version"]);
    if (result.code !== 0) throw new Error(result.stderr || "adb version failed");
    return result.stdout.split("\n")[0].trim();
  }

  async run(args: string[], signal?: AbortSignal): Promise<AdbResult> {
    const output = await new Deno.Command(this.binary, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal,
    }).output();
    return {
      code: output.code,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
    };
  }

  /** Runs adb against one device and throws a typed error on failure. */
  async device(
    serial: string,
    args: string[],
    timeoutMs: number | null = SHELL_TIMEOUT_MS,
  ): Promise<AdbResult> {
    const signal = timeoutMs === null ? undefined : AbortSignal.timeout(timeoutMs);
    let result: AdbResult;
    try {
      result = await this.run(["-s", serial, ...args], signal);
    } catch (error) {
      if (signal?.aborted) throw new AppError("adb-failed", `adb timed out after ${timeoutMs! / 1000}s`);
      throw error;
    }
    if (result.code !== 0) throw deviceError(result);
    return result;
  }

  /**
   * Runs a command in the device shell. The device shell re-parses the string, so callers must only
   * interpolate validated values (package names, numbers).
   */
  async shell(serial: string, command: string, timeoutMs: number | null = SHELL_TIMEOUT_MS): Promise<string> {
    return (await this.device(serial, ["shell", command], timeoutMs)).stdout;
  }

  spawn(args: string[], signal: AbortSignal): Deno.ChildProcess {
    return new Deno.Command(this.binary, { args, stdin: "null", stdout: "piped", stderr: "null", signal })
      .spawn();
  }
}

function deviceError(result: AdbResult): AppError {
  const text = (result.stderr || result.stdout).trim();
  const firstLine = text.split("\n")[0] || `adb exited with code ${result.code}`;
  if (/device .*not found|no devices|device offline|unauthorized|no permissions/i.test(text)) {
    return new AppError("device-unavailable", firstLine.replace(/^adb: |^error: /, ""), text);
  }
  return new AppError("adb-failed", firstLine, text);
}

/** pm and am often exit 0 while printing a failure. */
export function assertCommandSucceeded(output: string): void {
  const failure = output.split("\n").find((line) =>
    /^(Failure|Error|Exception|java\.|Security)/.test(line.trim())
  );
  if (failure) throw new AppError("adb-failed", failure.trim(), output);
}
