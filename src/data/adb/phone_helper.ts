import { encodeHex } from "@std/encoding/hex";
import { AppError } from "../../domain/errors.ts";
import type { Adb } from "./adb.ts";

const REMOTE_DIR = "/data/local/tmp";
const MAIN_CLASS = "phonemanager.Helper";

/**
 * Pushes the helper dex to the phone once per device (named by content hash, so upgrades replace it)
 * and runs it with app_process as the shell user. Nothing is installed and nothing keeps running.
 */
export class PhoneHelper {
  readonly #pushed = new Map<string, Promise<void>>();

  private constructor(
    private readonly adb: Adb,
    private readonly dex: Uint8Array,
    readonly remotePath: string,
  ) {}

  static async load(adb: Adb): Promise<PhoneHelper> {
    const dex = await Deno.readFile(new URL("./phone-helper.dex", import.meta.url));
    const hash = encodeHex(await crypto.subtle.digest("SHA-256", dex)).slice(0, 12);
    return new PhoneHelper(adb, dex, `${REMOTE_DIR}/phone-manager-helper-${hash}.dex`);
  }

  /** Arguments must be pre-validated; they are passed through the device shell. */
  async run(serial: string, args: (string | number)[], timeoutMs = 120_000): Promise<string> {
    await this.#ensurePushed(serial);
    try {
      return await this.adb.shell(
        serial,
        `CLASSPATH=${this.remotePath} app_process / ${MAIN_CLASS} ${args.join(" ")}`,
        timeoutMs,
      );
    } catch (error) {
      this.#pushed.delete(serial); // the file may have been removed; push again next time
      if (error instanceof AppError && error.detail?.includes("not-found:")) {
        throw new AppError("not-found", "App not found on the phone");
      }
      if (error instanceof AppError && error.code === "device-unavailable") throw error;
      const detail = error instanceof AppError ? error.detail : String(error);
      throw new AppError("helper-failed", "The phone helper failed", detail);
    }
  }

  #ensurePushed(serial: string): Promise<void> {
    let pushed = this.#pushed.get(serial);
    if (!pushed) {
      pushed = this.#push(serial).catch((error) => {
        this.#pushed.delete(serial);
        throw error;
      });
      this.#pushed.set(serial, pushed);
    }
    return pushed;
  }

  async #push(serial: string): Promise<void> {
    const present = await this.adb.shell(serial, `test -f ${this.remotePath} && echo present`).catch(() =>
      ""
    );
    if (present.includes("present")) return;
    const local = await Deno.makeTempFile({ prefix: "phone-manager-helper-", suffix: ".dex" });
    try {
      await Deno.writeFile(local, this.dex);
      await this.adb.shell(serial, `rm -f ${REMOTE_DIR}/phone-manager-helper-*.dex`);
      await this.adb.device(serial, ["push", local, this.remotePath]);
      await this.adb.shell(serial, `chmod 444 ${this.remotePath}`);
    } finally {
      await Deno.remove(local).catch(() => {});
    }
  }
}
