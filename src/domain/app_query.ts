import type { App } from "./models.ts";

export type AppKind = "all" | "user" | "system" | "updated-system";
export type AppState = "all" | "enabled" | "disabled" | "not-installed";
export type TriState = "any" | "yes" | "no";
export type AppSort = "name" | "package" | "installed" | "updated" | "size" | "target-sdk";

export interface AppFilter {
  query: string;
  kind: AppKind;
  state: AppState;
  /** Installer package, "" for unknown, or null for any. */
  installer: string | null;
  split: TriState;
  debuggable: TriState;
  launchable: TriState;
  /** Only apps holding this runtime permission. */
  grantedPermission: string | null;
  sort: AppSort;
  descending: boolean;
}

export const DEFAULT_FILTER: AppFilter = {
  query: "",
  kind: "user",
  state: "all",
  installer: null,
  split: "any",
  debuggable: "any",
  launchable: "any",
  grantedPermission: null,
  sort: "name",
  descending: false,
};

const KNOWN_INSTALLERS: Record<string, string> = {
  "com.android.vending": "Google Play",
  "org.fdroid.fdroid": "F-Droid",
  "org.fdroid.basic": "F-Droid",
  "com.aurora.store": "Aurora Store",
  "com.huawei.appmarket": "AppGallery",
  "com.hihonor.appmarket": "Honor App Market",
  "com.hihonor.android.clone": "Phone Clone",
  "com.huawei.android.clone": "Phone Clone",
  "com.google.android.apps.restore": "Google restore",
  "com.sec.android.easyMover": "Smart Switch",
  "com.sec.android.app.samsungapps": "Galaxy Store",
  "com.amazon.venezia": "Amazon Appstore",
  "com.xiaomi.market": "GetApps",
  "com.android.shell": "adb",
  "com.google.android.packageinstaller": "Package installer",
  "com.android.packageinstaller": "Package installer",
};

export const installerName = (installer: string | null): string =>
  installer === null ? "Unknown" : KNOWN_INSTALLERS[installer] ?? installer;

export const permissionName = (permission: string): string =>
  permission.replace(/^android\.permission\./, "").replace(
    /^com\.google\.android\.gms\.permission\./,
    "gms.",
  );

export const displayName = (app: App): string => app.metadata?.label ?? app.packageName;

function matchesTri(value: boolean | undefined, wanted: TriState): boolean {
  if (wanted === "any") return true;
  if (value === undefined) return false;
  return value === (wanted === "yes");
}

function searchText(app: App): string {
  const meta = app.metadata;
  return [
    app.packageName,
    meta?.label,
    meta?.versionName,
    String(app.versionCode),
    app.installer,
    installerName(app.installer),
    ...(meta?.permissions.map(permissionName) ?? []),
  ].filter(Boolean).join("\n").toLowerCase();
}

export function matchesFilter(app: App, filter: AppFilter): boolean {
  const meta = app.metadata;
  switch (filter.kind) {
    case "user":
      if (app.system) return false;
      break;
    case "system":
      if (!app.system) return false;
      break;
    case "updated-system":
      if (!meta?.updatedSystem) return false;
  }
  switch (filter.state) {
    case "enabled":
      if (!app.installed || !app.enabled) return false;
      break;
    case "disabled":
      if (!app.installed || app.enabled) return false;
      break;
    case "not-installed":
      if (app.installed) return false;
  }
  if (filter.installer !== null && (app.installer ?? "") !== filter.installer) return false;
  if (!matchesTri(meta ? meta.splitCount > 0 : undefined, filter.split)) return false;
  if (!matchesTri(meta?.debuggable, filter.debuggable)) return false;
  if (!matchesTri(meta?.launchable, filter.launchable)) return false;
  if (
    filter.grantedPermission !== null && !meta?.grantedRuntimePermissions.includes(filter.grantedPermission)
  ) {
    return false;
  }
  const terms = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const text = searchText(app);
  return terms.every((term) => text.includes(term));
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

function sortKey(app: App, sort: AppSort): number | string | null {
  switch (sort) {
    case "name":
      return displayName(app);
    case "package":
      return app.packageName;
    case "installed":
      return app.metadata?.firstInstallTime ?? null;
    case "updated":
      return app.metadata?.lastUpdateTime ?? null;
    case "size":
      return app.sizes ? app.sizes.appBytes + app.sizes.dataBytes + app.sizes.cacheBytes : null;
    case "target-sdk":
      return app.metadata?.targetSdk ?? null;
  }
}

/** Filters and sorts. Apps lacking the sort value always go last, whatever the direction. */
export function queryApps(apps: readonly App[], filter: AppFilter): App[] {
  const direction = filter.descending ? -1 : 1;
  return apps
    .filter((app) => matchesFilter(app, filter))
    .map((app) => ({ app, key: sortKey(app, filter.sort) }))
    .sort((a, b) => {
      if (a.key === null || b.key === null) {
        if (a.key === b.key) return collator.compare(a.app.packageName, b.app.packageName);
        return a.key === null ? 1 : -1;
      }
      const order = typeof a.key === "string"
        ? collator.compare(a.key, b.key as string)
        : (a.key as number) - (b.key as number);
      return order * direction || collator.compare(a.app.packageName, b.app.packageName);
    })
    .map(({ app }) => app);
}

/** Distinct values for the installer and permission filter menus. */
export function filterOptions(
  apps: readonly App[],
): { installers: (string | null)[]; permissions: string[] } {
  const installers = new Set<string | null>();
  const permissions = new Set<string>();
  for (const app of apps) {
    installers.add(app.installer);
    app.metadata?.grantedRuntimePermissions.forEach((p) => permissions.add(p));
  }
  return {
    installers: [...installers].sort((a, b) => collator.compare(installerName(a), installerName(b))),
    permissions: [...permissions].sort((a, b) => collator.compare(permissionName(a), permissionName(b))),
  };
}
