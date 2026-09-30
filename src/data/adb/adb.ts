import { AppError } from "../../domain/errors.ts";

export interface AdbResult {
  code: number;
  stdout: string;
  stderr: string;
}

const SHELL_TIMEOUT_MS = 60_000;
const decoder = new TextDecoder();

/** Thin wrapper over the adb binary. Arguments are passed as argv, never through a host shell. */
export class Adb {
  constructor(readonly binary = "adb") {}

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
