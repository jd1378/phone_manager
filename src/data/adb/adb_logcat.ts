import { TextLineStream } from "@std/streams/text-line-stream";
import type { LogLine } from "../../domain/models.ts";
import type { LogSource } from "../../domain/ports.ts";
import { isPackageName, requireValid } from "../../domain/validation.ts";
import type { Adb } from "./adb.ts";
import { parseLogcatLine, parseProcessIds } from "./parsers.ts";

const HISTORY_LINES = 500;

export class AdbLogcat implements LogSource {
  constructor(private readonly adb: Adb) {}

  async *lines(serial: string, signal: AbortSignal): AsyncGenerator<LogLine> {
    const child = this.adb.spawn(
      ["-s", serial, "logcat", "-v", "threadtime", "-T", String(HISTORY_LINES)],
      signal,
    );
    const stream = child.stdout
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream());
    try {
      for await (const text of stream) {
        const line = parseLogcatLine(text);
        if (line) yield line;
      }
    } finally {
      try {
        child.kill();
      } catch {
        // already exited
      }
    }
  }

  async processIds(serial: string, packageName: string): Promise<number[]> {
    requireValid(isPackageName, packageName, "package name");
    return parseProcessIds(await this.adb.shell(serial, "ps -A -o PID,NAME"), packageName);
  }
}
