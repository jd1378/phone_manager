import type { LibraryEntry } from "./models.ts";

export type LibraryStatus = "not-installed" | "installed" | "newer-in-library" | "older-in-library";

export function libraryStatus(entry: LibraryEntry, installed: ReadonlyMap<string, number>): LibraryStatus {
  const versionCode = installed.get(entry.packageName);
  if (versionCode === undefined) return "not-installed";
  if (entry.versionCode > versionCode) return "newer-in-library";
  if (entry.versionCode < versionCode) return "older-in-library";
  return "installed";
}

/** Entries grouped per package, newest version first; groups sorted by most recent backup. */
export function groupByPackage(entries: readonly LibraryEntry[]): LibraryEntry[][] {
  const groups = new Map<string, LibraryEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.packageName) ?? [];
    group.push(entry);
    groups.set(entry.packageName, group);
  }
  const newestBackup = (group: LibraryEntry[]) =>
    group.reduce((a, e) => (e.backedUpAt > a ? e.backedUpAt : a), "");
  return [...groups.values()]
    .map((group) => group.sort((a, b) => b.versionCode - a.versionCode))
    .sort((a, b) => newestBackup(b).localeCompare(newestBackup(a)));
}

export const libraryKey = (entry: { packageName: string; versionCode: number }) =>
  `${entry.packageName}@${entry.versionCode}`;
