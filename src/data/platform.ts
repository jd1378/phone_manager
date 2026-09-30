import { join } from "@std/path";

export function homeDirectory(): string {
  const home = Deno.build.os === "windows" ? Deno.env.get("USERPROFILE") : Deno.env.get("HOME");
  if (!home) throw new Error("Cannot find the home directory (HOME or USERPROFILE is not set)");
  return home;
}

export function configDirectory(appName: string): string {
  switch (Deno.build.os) {
    case "windows":
      return join(Deno.env.get("APPDATA") ?? join(homeDirectory(), "AppData", "Roaming"), appName);
    case "darwin":
      return join(homeDirectory(), "Library", "Application Support", appName);
    default:
      return join(Deno.env.get("XDG_CONFIG_HOME") || join(homeDirectory(), ".config"), appName);
  }
}

export function cacheDirectory(appName: string): string {
  switch (Deno.build.os) {
    case "windows":
      return join(
        Deno.env.get("LOCALAPPDATA") ?? join(homeDirectory(), "AppData", "Local"),
        appName,
        "cache",
      );
    case "darwin":
      return join(homeDirectory(), "Library", "Caches", appName);
    default:
      return join(Deno.env.get("XDG_CACHE_HOME") || join(homeDirectory(), ".cache"), appName);
  }
}

/** Opens a URL in the default browser; failures are reported, not thrown. */
export async function openBrowser(url: string): Promise<boolean> {
  const [command, args] = Deno.build.os === "windows"
    ? ["explorer", [url]]
    : Deno.build.os === "darwin"
    ? ["open", [url]]
    : ["xdg-open", [url]];
  try {
    const child = new Deno.Command(command, { args, stdin: "null", stdout: "null", stderr: "null" }).spawn();
    // explorer.exe exits with 1 even on success; only a spawn failure counts.
    await child.status;
    return true;
  } catch {
    return false;
  }
}
