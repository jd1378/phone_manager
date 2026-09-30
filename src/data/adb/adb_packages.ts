import { AppError } from "../../domain/errors.ts";
import { type InstallFailure, parseInstallOutput } from "../../domain/install_failure.ts";
import type { AppAction, AppDetails, AppSizes, AppSummary, InstallOptions } from "../../domain/models.ts";
import type { HelperApp, PackageGateway } from "../../domain/ports.ts";
import { isPackageName, isPermissionName, isUserId, requireValid } from "../../domain/validation.ts";
import { type Adb, assertCommandSucceeded } from "./adb.ts";
import {
  parseHelperInfo,
  parseHelperList,
  parseHelperSizes,
  parsePackageList,
  parsePackageNames,
  parsePmPath,
} from "./parsers.ts";
import type { PhoneHelper } from "./phone_helper.ts";

const COMPONENT = /^[A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+$/;

export class AdbPackages implements PackageGateway {
  constructor(private readonly adb: Adb, private readonly helper: PhoneHelper) {}

  async list(serial: string, user: number): Promise<AppSummary[]> {
    requireValid(isUserId, user, "user");
    const pm = (flags: string) => this.adb.shell(serial, `pm list packages ${flags} --user ${user}`);
    const [all, system, disabled, installed] = await Promise.all([
      pm("-f -U -i --show-versioncode -u"),
      pm("-s -u"),
      pm("-d"),
      pm(""),
    ]);
    const systemNames = parsePackageNames(system);
    const disabledNames = parsePackageNames(disabled);
    const installedNames = parsePackageNames(installed);
    return parsePackageList(all).map((line) => ({
      ...line,
      system: systemNames.has(line.packageName),
      enabled: !disabledNames.has(line.packageName),
      installed: installedNames.has(line.packageName),
    }));
  }

  async metadata(serial: string, iconSize: number): Promise<HelperApp[]> {
    return parseHelperList(await this.helper.run(serial, ["list", Math.round(iconSize)]));
  }

  async sizes(serial: string, user: number): Promise<Map<string, AppSizes>> {
    requireValid(isUserId, user, "user");
    return parseHelperSizes(await this.helper.run(serial, ["sizes", user], 300_000));
  }

  async details(serial: string, packageName: string): Promise<AppDetails> {
    requireValid(isPackageName, packageName, "package name");
    return parseHelperInfo(await this.helper.run(serial, ["info", packageName]));
  }

  async apkPaths(serial: string, packageName: string, user: number): Promise<string[]> {
    requireValid(isPackageName, packageName, "package name");
    requireValid(isUserId, user, "user");
    return parsePmPath(await this.adb.shell(serial, `pm path --user ${user} ${packageName}`));
  }

  async pull(serial: string, remotePath: string, localPath: string): Promise<void> {
    await this.adb.device(serial, ["pull", remotePath, localPath], null);
  }

  async install(
    serial: string,
    localPaths: string[],
    options: InstallOptions,
  ): Promise<InstallFailure | null> {
    requireValid(isUserId, options.user, "user");
    if (localPaths.length === 0) throw new AppError("invalid-input", "No APK files to install");
    const args = [
      "-s",
      serial,
      localPaths.length === 1 ? "install" : "install-multiple",
      "-r",
      ...(options.grantPermissions ? ["-g"] : []),
      ...(options.allowDowngrade ? ["-d"] : []),
      "--user",
      String(options.user),
      ...localPaths,
    ];
    const result = await this.adb.run(args);
    const failure = parseInstallOutput(`${result.stdout}\n${result.stderr}`);
    if (failure?.code === "UNKNOWN" && /device .*not found|offline|unauthorized/.test(failure.message)) {
      throw new AppError("device-unavailable", failure.message);
    }
    return failure;
  }

  async act(serial: string, packageName: string, user: number, action: AppAction): Promise<void> {
    requireValid(isPackageName, packageName, "package name");
    requireValid(isUserId, user, "user");
    if (action === "launch") return this.#launch(serial, packageName, user);
    const commands: Record<Exclude<AppAction, "launch">, string> = {
      "force-stop": `am force-stop --user ${user} ${packageName}`,
      "open-settings":
        `am start --user ${user} -a android.settings.APPLICATION_DETAILS_SETTINGS -d package:${packageName}`,
      "enable": `pm enable --user ${user} ${packageName}`,
      "disable": `pm disable-user --user ${user} ${packageName}`,
      "clear-data": `pm clear --user ${user} ${packageName}`,
      "uninstall": `pm uninstall --user ${user} ${packageName}`,
      "uninstall-keep-data": `pm uninstall -k --user ${user} ${packageName}`,
      "reinstall-existing": `pm install-existing --user ${user} ${packageName}`,
    };
    assertCommandSucceeded(await this.adb.shell(serial, `${commands[action]} 2>&1`));
  }

  async #launch(serial: string, packageName: string, user: number): Promise<void> {
    const resolved = await this.adb.shell(
      serial,
      `cmd package resolve-activity --brief --user ${user} -a android.intent.action.MAIN ` +
        `-c android.intent.category.LAUNCHER ${packageName}`,
    );
    const component = resolved.trim().split("\n").at(-1)?.trim() ?? "";
    if (!COMPONENT.test(component)) throw new AppError("not-found", "This app has no launcher screen");
    assertCommandSucceeded(await this.adb.shell(serial, `am start --user ${user} -n '${component}' 2>&1`));
  }

  async setPermission(
    serial: string,
    packageName: string,
    user: number,
    permission: string,
    granted: boolean,
  ): Promise<void> {
    requireValid(isPackageName, packageName, "package name");
    requireValid(isUserId, user, "user");
    requireValid(isPermissionName, permission, "permission");
    const verb = granted ? "grant" : "revoke";
    assertCommandSucceeded(
      await this.adb.shell(serial, `pm ${verb} --user ${user} ${packageName} ${permission} 2>&1`),
    );
  }
}
