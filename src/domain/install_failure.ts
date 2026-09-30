export interface InstallFailure {
  code: string;
  message: string;
  hint: string | null;
}

const HINTS: Record<string, string> = {
  INSTALL_FAILED_UPDATE_INCOMPATIBLE:
    "The installed app is signed with a different key. Uninstall it first (this deletes its data), then install again.",
  INSTALL_FAILED_VERSION_DOWNGRADE:
    "The phone has a newer version. Downgrading is usually only allowed for debuggable apps; try 'Allow downgrade' or uninstall first.",
  INSTALL_FAILED_OLDER_SDK: "The app needs a newer Android version than this phone runs.",
  INSTALL_FAILED_NO_MATCHING_ABIS:
    "The app has no native code for this phone's CPU (for example an x86-only build).",
  INSTALL_FAILED_INSUFFICIENT_STORAGE: "The phone is out of storage.",
  INSTALL_FAILED_ALREADY_EXISTS: "The app is already installed.",
  INSTALL_FAILED_DUPLICATE_PERMISSION:
    "Another installed app already defines a permission this app declares.",
  INSTALL_FAILED_MISSING_SPLIT:
    "Some split APKs are missing. Install the base APK together with all its splits.",
  INSTALL_FAILED_INVALID_APK: "The APK set is inconsistent, often splits from different versions or apps.",
  INSTALL_FAILED_TEST_ONLY: "This is a test-only build and needs 'adb install -t'.",
  INSTALL_FAILED_USER_RESTRICTED:
    "Installing from USB is blocked on the phone. Enable 'Install via USB' in developer options.",
  INSTALL_FAILED_ABORTED: "The install was cancelled on the phone.",
  INSTALL_FAILED_VERIFICATION_FAILURE: "Package verification (for example Play Protect) rejected the app.",
  INSTALL_PARSE_FAILED_NO_CERTIFICATES: "The APK is not signed or the signature is broken.",
  INSTALL_PARSE_FAILED_NOT_APK: "The file is not a valid APK.",
  INSTALL_FAILED_DEPRECATED_SDK_VERSION:
    "The app targets an Android version this phone refuses to install (too old target SDK).",
};

/** Extracts the failure from `adb install` output, or null when the output reports success. */
export function parseInstallOutput(output: string): InstallFailure | null {
  const bracketed = output.match(/Failure \[([A-Z_]+)(?::\s*([^\]]*))?\]/);
  if (bracketed) {
    const code = bracketed[1];
    return { code, message: bracketed[2]?.trim() || code, hint: HINTS[code] ?? null };
  }
  if (/^Success\s*$/m.test(output)) return null;
  const line = output.split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "No output from adb";
  return { code: "UNKNOWN", message: line, hint: null };
}
