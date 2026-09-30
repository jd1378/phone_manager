import { useMemo, useState } from "preact/hooks";
import { groupByPackage, libraryKey, type LibraryStatus, libraryStatus } from "../../../domain/library.ts";
import type { LibraryEntry } from "../../../domain/models.ts";
import { formatBytes, formatDateTime, plural } from "../format.ts";
import {
  apps,
  appsStatus,
  currentDevice,
  deleteBackups,
  deviceReady,
  dialog,
  installFromLibrary,
  library,
  libraryStatus as loadStatus,
  refreshLibrary,
  settings,
} from "../state.ts";

type Show = "all" | "not-installed" | "newer-in-library";

const STATUS_TEXT: Record<LibraryStatus, string> = {
  "not-installed": "Not on this phone",
  "installed": "Installed",
  "newer-in-library": "Newer than the phone",
  "older-in-library": "Older than the phone",
};

const totalSize = (entry: LibraryEntry) => entry.files.reduce((sum, f) => sum + f.size, 0);

export function LibraryView() {
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const installed = useMemo(
    () => new Map(apps.value.filter((a) => a.installed).map((a) => [a.packageName, a.versionCode])),
    [apps.value],
  );
  const compare = deviceReady.value && appsStatus.value === "ready";
  const groups = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return groupByPackage(library.value).filter((group) => {
      const latest = group[0];
      const text = `${latest.packageName}\n${latest.label ?? ""}\n${
        group.map((e) => e.versionName).join(" ")
      }`
        .toLowerCase();
      if (!terms.every((t) => text.includes(t))) return false;
      if (show === "all" || !compare) return true;
      return libraryStatus(latest, installed) === show;
    });
  }, [library.value, query, show, installed, compare]);

  const toggle = (entry: LibraryEntry) => {
    const next = new Set(picked);
    const key = libraryKey(entry);
    // One version per app: picking a version replaces any other picked version of the same app.
    for (const other of library.value) {
      if (other.packageName === entry.packageName && libraryKey(other) !== key) {
        next.delete(libraryKey(other));
      }
    }
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };
  const pickedEntries = library.value.filter((e) => picked.has(libraryKey(e)));

  return (
    <section class="library" aria-label="Backups">
      <div class="library-head">
        <p>
          Backups are saved in <span class="mono">{settings.value?.backupDirectory}</span>
        </p>
        <button type="button" onClick={() => (dialog.value = "settings")}>Change folder</button>
        <button type="button" onClick={refreshLibrary}>Refresh</button>
      </div>
      <div class="toolbar">
        <input
          type="search"
          class="search"
          placeholder="Search backups by name, package or version"
          aria-label="Search backups"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <div class="segmented" role="radiogroup" aria-label="Show">
          {([["all", "All"], ["not-installed", "Missing on phone"], [
            "newer-in-library",
            "Newer than phone",
          ]] as [
            Show,
            string,
          ][]).map(([key, text]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={show === key}
              disabled={key !== "all" && !compare}
              onClick={() => setShow(key)}
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      {loadStatus.value === "loading" && <p class="empty">Reading the backup folder…</p>}
      {loadStatus.value === "ready" && library.value.length === 0 && (
        <p class="empty">
          No backups yet. Select apps in the Apps tab and choose Back up, or use Back up APK in an app's
          details.
        </p>
      )}
      {library.value.length > 0 && groups.length === 0 && <p class="empty">No backups match.</p>}

      <ul class="library-list">
        {groups.map((group) => {
          const latest = group[0];
          return (
            <li key={latest.packageName} class="library-group">
              <div class="library-app">
                <strong>{latest.label ?? latest.packageName}</strong>
                {latest.label && <span class="mono muted">{latest.packageName}</span>}
              </div>
              <ul class="versions">
                {group.map((entry) => {
                  const status = compare ? libraryStatus(entry, installed) : null;
                  const key = libraryKey(entry);
                  return (
                    <li key={key} class={`version-row${picked.has(key) ? " selected" : ""}`}>
                      <input
                        type="checkbox"
                        class="row-check"
                        aria-label={`Select version ${entry.versionName ?? entry.versionCode}`}
                        checked={picked.has(key)}
                        onChange={() => toggle(entry)}
                      />
                      <span class="version-name">
                        {entry.versionName ?? entry.versionCode}
                        <span class="muted">({entry.versionCode})</span>
                      </span>
                      <span class="muted">{formatDateTime(entry.backedUpAt)}</span>
                      <span class="muted">
                        {formatBytes(totalSize(entry))}
                        {entry.files.length > 1 && `, ${entry.files.length} APKs`}
                      </span>
                      <span class="muted">{entry.source.model ? `from ${entry.source.model}` : ""}</span>
                      {status && <span class={`badge status-${status}`}>{STATUS_TEXT[status]}</span>}
                      <span class="row-actions">
                        <button
                          type="button"
                          disabled={!deviceReady.value}
                          onClick={() =>
                            installFromLibrary([{
                              packageName: entry.packageName,
                              versionCode: entry.versionCode,
                            }])}
                        >
                          Install
                        </button>
                        <button type="button" class="danger-quiet" onClick={() => deleteBackups([entry])}>
                          Delete
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>

      {pickedEntries.length > 0 && (
        <div class="selection-bar" role="region" aria-label="Selected backups">
          <strong>{plural(pickedEntries.length, "backup")} selected</strong>
          <button
            type="button"
            class="primary"
            disabled={!deviceReady.value}
            onClick={() =>
              installFromLibrary(
                pickedEntries.map(({ packageName, versionCode }) => ({ packageName, versionCode })),
              )}
          >
            Install on {currentDevice.value?.model ?? "phone"}
          </button>
          <button
            type="button"
            class="danger"
            onClick={async () => {
              await deleteBackups(pickedEntries);
              setPicked(new Set());
            }}
          >
            Delete
          </button>
          <button type="button" class="link" onClick={() => setPicked(new Set())}>Clear selection</button>
        </div>
      )}
    </section>
  );
}
