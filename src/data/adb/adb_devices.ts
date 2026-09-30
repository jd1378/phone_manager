import { AppError } from "../../domain/errors.ts";
import type { Device, DeviceInfo, DiscoveredService } from "../../domain/models.ts";
import type { DeviceRegistry } from "../../domain/ports.ts";
import { isHost, isPairingCode, isPort, isSerial, requireValid } from "../../domain/validation.ts";
import type { Adb } from "./adb.ts";
import { parseBatteryLevel, parseDevices, parseDf, parseMdnsServices, parseUsers } from "./parsers.ts";

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

  async discover(): Promise<DiscoveredService[]> {
    const result = await this.adb.run(["mdns", "services"], AbortSignal.timeout(10_000)).catch(() => null);
    return result?.code === 0 ? parseMdnsServices(result.stdout) : [];
  }

  async pair(host: string, port: number, code: string): Promise<string> {
    requireValid(isPairingCode, code, "pairing code");
    const result = await this.adb.run(["pair", hostPort(host, port), code], AbortSignal.timeout(30_000));
    const text = `${result.stdout}\n${result.stderr}`.trim();
    if (result.code !== 0 || !/Successfully paired/i.test(text)) throw wirelessError("pair", text);
    return text;
  }

  async connect(host: string, port: number): Promise<string> {
    const result = await this.adb.run(["connect", hostPort(host, port)], AbortSignal.timeout(30_000));
    const text = `${result.stdout}\n${result.stderr}`.trim();
    if (result.code !== 0 || !/connected to/i.test(text) || /cannot|failed/i.test(text)) {
      throw wirelessError("connect", text);
    }
    return text;
  }

  async disconnect(serial: string): Promise<void> {
    requireValid(isSerial, serial, "serial");
    await this.adb.run(["disconnect", serial]);
  }
}

/** adb's pairing and connection errors say little about the usual cause; name it. */
export function wirelessError(kind: "pair" | "connect", text: string): AppError {
  let message = text.split("\n").at(-1) || (kind === "pair" ? "Pairing failed" : "Connection failed");
  if (kind === "pair" && /protocol fault|handshake|unable to start pairing/i.test(text)) {
    message = "The phone refused the pairing connection. Use the IP address and port from the " +
      "'Pair device with pairing code' popup (not the one on the Wireless debugging screen), " +
      "and keep that popup open while pairing.";
  } else if (kind === "pair" && /wrong password|connection was dropped/i.test(text)) {
    message = "Wrong pairing code, or the pairing popup was closed. Open it again and use the new code.";
  } else if (kind === "connect" && /failed to authenticate|unauthorized/i.test(text)) {
    message = "This computer is not paired with the phone yet. Pair it first with a pairing code.";
  } else if (kind === "connect" && /refused|no route|timed out|unreachable/i.test(text)) {
    message = "The phone did not answer at that address. Check the IP address and port on the Wireless " +
      "debugging screen (the port changes each time wireless debugging is turned on) and that both are " +
      "on the same network.";
  }
  return new AppError("adb-failed", message, text);
}

function hostPort(host: string, port: number): string {
  requireValid(isHost, host, "host");
  requireValid(isPort, port, "port");
  return host.includes(":") && !host.startsWith("[") ? `[${host}]:${port}` : `${host}:${port}`;
}
