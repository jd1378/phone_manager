# Phone Manager

A desktop app for managing the apps on Android phones over adb: browse and search installed apps, back up
their APKs, install APKs by drag and drop, and watch an app's logcat. It is built with `deno desktop` and also
runs in a browser during development.

## Requirements

- `adb` ([Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools)), on your
  `PATH` or in the default Android SDK folder (`ANDROID_HOME`, `~/Android/Sdk`, `~/Library/Android/sdk`,
  `%LOCALAPPDATA%\Android\Sdk`, or Homebrew on macOS). Phone Manager stops with a message if it is missing.
- A phone with USB debugging enabled (or wireless debugging). Android 9 or newer.
- On Linux, WebKitGTK 4.1 (`webkit2gtk4.1` on Fedora, `libwebkit2gtk-4.1-0` on Debian and Ubuntu), which most
  desktops already have.
- To run from source: [Deno](https://deno.com) 2.9 or newer (2.9.6 or newer to build packages).

## Install

Download a package from the [releases](https://github.com/jd1378/phone_manager/releases):

- **Linux**: `.AppImage` (make it executable and run it), `.deb` or `.rpm`. Some older AppImageLauncher
  versions cannot open the AppImage; run it with AppImageLauncher disabled or use the `.deb`/`.rpm`.
- **Windows**: `.msi`. The installer is not code-signed yet, so SmartScreen asks for confirmation.
- **macOS**: `.dmg`. The app is only ad-hoc signed, so the first launch needs right-click, Open (or
  `xattr -dr com.apple.quarantine "/Applications/Phone Manager.app"`).

## Run from source

```sh
deno task dev                   # opens the UI in your browser
deno task dev --no-open --port 8080
```

The terminal prints the address to open. It contains a one-time token for this run, so bookmarking the plain
address does not work; use the printed link.

## Features

- **Apps**: every package for the chosen phone and user or work profile. You can search by name, package,
  version, installer or permission, filter by type, state, installer, granted permission, split APKs, launcher
  icon or debuggable, and sort by name, dates, size or target SDK. The list can be exported as CSV or JSON.
- **Names, icons and sizes** load when you click _Load names and icons_, or automatically if that is turned on
  in Settings (see [the phone helper](#the-phone-helper)).
- **App actions**: open, force stop, open App info on the phone, back up, disable or enable, clear data,
  uninstall (optionally keeping data), and reinstall apps that were uninstalled with their data kept (useful
  for undoing a debloat). Runtime permissions can be granted or revoked.
- **Batch actions**: select several apps to back up, disable, enable, force stop or uninstall them.
- **Backups**: the APKs, including all split APKs, are copied into your backup folder. The Backups tab lists
  them against the connected phone ("missing on phone", "newer than phone"), and you can install one or many
  onto any phone.
- **Install**: drop `.apk` files or `.apks`, `.xapk` and `.apkm` bundles anywhere on the window, or use
  _Install APK_. Loose APKs are grouped by package, so a base APK and its splits install together. Before
  installing, Phone Manager warns about downgrades, a too-old Android version, missing base APKs and signing
  key mismatches (for backups).
- **Logcat**: live log of one app's processes, following restarts and keeping crash lines, filtered by level
  and text.
- **Wi-Fi**: pair and connect to phones over wireless debugging.
- Phones are picked up as they connect and disconnect.

## The phone helper

`pm` cannot report app names, icons, sizes, signing certificates or permission types. For those, Phone Manager
pushes a small helper (`src/data/adb/phone-helper.dex`, about 10 KB) to `/data/local/tmp` on the phone and
runs it with `app_process` as the adb shell user, the same technique scrcpy uses. The helper is not installed
as an app, has no more rights than `adb shell`, and exits once it has printed its output.

It runs only when you load names and icons, open an app's details, or back up an app. The plain app list uses
`pm` only. To remove it from a phone: `adb shell rm /data/local/tmp/phone-manager-helper-*.dex`.

## Backup folder layout

```
<backup folder>/<package>/<versionCode>/base.apk
                                        split_config.arm64_v8a.apk
                                        metadata.json   (label, version, signer, SHA-256 of each file)
```

The folder is the source of truth: copy, move or delete entries by hand as you like. The backup folder is set
in Settings. Settings are stored in `~/.config/phone-manager/settings.json` (Linux),
`~/Library/Application Support/phone-manager` (macOS) or `%APPDATA%\phone-manager` (Windows).

## Limitations

- Only APKs are backed up. App data cannot be read without root, and `adb backup` no longer works for most
  apps.
- OBB expansion files inside `.xapk` bundles are not installed.
- Downgrades usually only work for debuggable apps. Updating an app signed with a different key requires
  uninstalling it first.

## Security

The UI talks to a server on 127.0.0.1 only, in the browser and in the desktop app alike. Because it can
install and remove apps, every API request must carry a per-run session cookie (HttpOnly, SameSite=Strict),
must use a `127.0.0.1`/`localhost` Host header (blocking DNS rebinding) and, when the browser sends an Origin,
our own origin. The browser receives the session through the printed link; the desktop window asks for it over
an in-process `deno desktop` binding that web pages cannot reach. Everything that ends up in a phone shell
command is validated first (package names, permissions, user IDs). adb is always run with an argument list,
never through a host shell.

## Development

```sh
deno task test                          # unit tests
deno task check                         # type check, lint, format check
deno task package                       # desktop packages for this machine, in build/
deno task package linux-x64 windows-x64 # named targets; macOS targets need a macOS host
deno task build:helper                  # rebuild the phone helper (needs a JDK and the Android SDK)
```

`deno task package` builds `.AppImage`, `.deb` and `.rpm` for Linux, `.msi` for Windows and `.dmg` for macOS.
Linux and Windows packages cross-build from Linux. macOS packages need macOS, because `deno desktop` uses
`iconutil`, `hdiutil` and `codesign` there.

### Releases

CI (`.github/workflows/ci.yml`) type-checks, lints and tests every push and pull request, then packages every
target and uploads the packages as workflow artifacts. To publish a release, set `version` in `deno.json`,
commit, and push a matching tag:

```sh
git tag v0.2.0 && git push origin v0.2.0
```

The tag must match `deno.json`, or the build fails. The release gets every package plus `SHA256SUMS.txt`.

Layout (clean architecture: `domain` depends on nothing, `data` and `presentation` depend on `domain`, and
`src/app.ts` wires them together for the browser entrypoint `src/main.ts` and the desktop entrypoint
`src/desktop.ts`):

- `src/domain`: models, ports, validation, search and filters, install planning, use cases (catalog, backup,
  install, logcat, batch).
- `src/data`: adb gateways and parsers, the phone helper runner, APK and ZIP reading, the file-based backup
  library, settings and uploads.
- `src/presentation/http`: the HTTP API, security, server-sent events and background jobs.
- `src/presentation/web`: the Preact UI, bundled into `dist/` by `deno task build:web`.
- `helper/`: the Java source of the phone helper.
- `scripts/`: dev server, web bundling and packaging; `assets/icons/`: app icons.
