// Runtime permissions, shared by `deno task dev` (browser mode) and `deno task package` (desktop app).
// Read/write stay broad because the backup folder is chosen at runtime and can be anywhere. Running
// programs is broad too: adb may live in an SDK folder found at runtime (see adbCandidates), and with
// unrestricted write access a narrower run permission would add little.
export const PERMISSIONS = [
  "--allow-run",
  // The local UI server, and the bloatware list (see src/data/debloat/uad_list.ts).
  "--allow-net=127.0.0.1,raw.githubusercontent.com",
  "--allow-read",
  "--allow-write",
  "--allow-env=HOME,USERPROFILE,APPDATA,LOCALAPPDATA,XDG_CONFIG_HOME,XDG_CACHE_HOME,TMPDIR,TMP,TEMP,ANDROID_HOME,ANDROID_SDK_ROOT",
];
