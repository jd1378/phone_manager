import { AppError } from "../../domain/errors.ts";
import type { Device, DeviceInfo } from "../../domain/models.ts";
import type { DeviceRegistry } from "../../domain/ports.ts";
import { isHost, isPairingCode, isPort, isSerial, requireValid } from "../../domain/validation.ts";
import type { Adb } from "./adb.ts";
import { parseBatteryLevel, parseDevices, parseDf, parseUsers } from "./parsers.ts";

const SECTION = "__phone_manager_section__";
const WATCH_DEBOUNCE_MS = 250;
const WATCH_RESTART_MS = 2000;

export class AdbDevices implements DeviceRegistry {
  constructor(private readonly adb: Adb) {}

  async list(): Promise<Device[]> {
    const result = await this.adb.run(["devices", "-l"]);
    if (result.code !== 0) throw new AppError("adb-failed", result.stderr.trim() || "adb devices failed");
    return parseDevices(result.stdout);
  }

  async info(serial: string): Promise<DeviceInfo> {
    const props = [
      "ro.product.manufacturer",
      "ro.product.model",
      "ro.build.version.release",
      "ro.build.version.sdk",
    ];
    const output = await this.adb.shell(
      serial,
      [
        ...props.map((prop) => `getprop ${prop}`),
        "getprop ro.product.cpu.abilist",
        `echo ${SECTION}`,
        "dumpsys battery",
        `echo ${SECTION}`,
        "df /data",
        `echo ${SECTION}`,
        "pm list users",
      ].join("; "),
    );
    const [propsText, battery = "", df = "", users = ""] = output.split(SECTION);
    const [manufacturer, model, androidVersion, sdk, abis] = propsText.split(/\r?\n/).map((l) => l.trim());
    return {
      serial,
      manufacturer: manufacturer ?? "",
      model: model ?? "",
      androidVersion: androidVersion ?? "",
      sdk: Number(sdk) || 0,
      abis: (abis ?? "").split(",").filter(Boolean),
      batteryLevel: parseBatteryLevel(battery),
      storage: parseDf(df),
      users: parseUsers(users),
    };
  }

  /** `adb track-devices` prints on every change; its output is only a trigger to re-list. */
  watch(onChange: () => void, signal: AbortSignal): void {
    let timer: number | undefined;
    const notify = () => {
      clearTimeout(timer);
      timer = setTimeout(onChange, WATCH_DEBOUNCE_MS);
    };
    const loop = async () => {
      while (!signal.aborted) {
        try {
          const child = this.adb.spawn(["track-devices"], signal);
          for await (const _chunk of child.stdout) notify();
          await child.status;
        } catch {
          // adb server restarting; retry below
        }
        if (signal.aborted) break;
        notify();
        await new Promise((resolve) => setTimeout(resolve, WATCH_RESTART_MS));
      }
      clearTimeout(timer);
    };
    loop();
  }

  async pair(host: string, port: number, code: string): Promise<string> {
    requireValid(isPairingCode, code, "pairing code");
    const result = await this.adb.run(["pair", hostPort(host, port), code], AbortSignal.timeout(30_000));
    const text = `${result.stdout}\n${result.stderr}`.trim();
    if (result.code !== 0 || !/Successfully paired/i.test(text)) {
      throw new AppError("adb-failed", text.split("\n").at(-1) || "Pairing failed");
    }
    return text;
  }

  async connect(host: string, port: number): Promise<string> {
    const result = await this.adb.run(["connect", hostPort(host, port)], AbortSignal.timeout(30_000));
    const text = `${result.stdout}\n${result.stderr}`.trim();
    if (result.code !== 0 || !/connected to/i.test(text) || /cannot|failed/i.test(text)) {
      throw new AppError("adb-failed", text || "Connection failed");
    }
    return text;
  }

  async disconnect(serial: string): Promise<void> {
    requireValid(isSerial, serial, "serial");
    await this.adb.run(["disconnect", serial]);
  }
}

function hostPort(host: string, port: number): string {
  requireValid(isHost, host, "host");
  requireValid(isPort, port, "port");
  return host.includes(":") && !host.startsWith("[") ? `[${host}]:${port}` : `${host}:${port}`;
}
