import type { LogLine } from "../models.ts";
import type { LogSource } from "../ports.ts";

export const PID_REFRESH_MS = 2000;

/**
 * Logcat lines from the package's processes. PIDs are refreshed while streaming so restarts are
 * followed, and old PIDs are kept so a crash's last lines still show. Lines from other processes
 * that mention the package (for example "Process com.app has died") are included too.
 */
export async function* appLog(
  source: LogSource,
  serial: string,
  packageName: string,
  signal: AbortSignal,
  refreshMs = PID_REFRESH_MS,
): AsyncGenerator<LogLine> {
  const pids = new Set<number>();
  const refresh = async () => {
    try {
      for (const pid of await source.processIds(serial, packageName)) pids.add(pid);
    } catch {
      // device busy or gone; the log stream reports disconnects itself
    }
  };
  await refresh();
  const timer = setInterval(refresh, refreshMs);
  try {
    for await (const line of source.lines(serial, signal)) {
      if (pids.has(line.pid) || line.message.includes(packageName)) yield line;
    }
  } finally {
    clearInterval(timer);
  }
}
