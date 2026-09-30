// Runtime permissions for the app, shared by `deno task dev` and `deno task compile`.
// Read/write stay broad because the backup folder is chosen at runtime and can be anywhere.
const BROWSER_OPENER: Record<string, string> = { linux: "xdg-open", darwin: "open", windows: "explorer" };

export function permissions(os: string): string[] {
  return [
    `--allow-run=adb,${BROWSER_OPENER[os] ?? "xdg-open"}`,
    "--allow-net=127.0.0.1",
    "--allow-read",
    "--allow-write",
    "--allow-env=HOME,USERPROFILE,APPDATA,LOCALAPPDATA,XDG_CONFIG_HOME,TMPDIR,TMP,TEMP",
  ];
}
