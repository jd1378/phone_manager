import { useMemo, useRef } from "preact/hooks";
import { useEffect } from "preact/hooks";
import {
  type AppFilter,
  type AppKind,
  type AppSort,
  type AppState,
  type DebloatFilter,
  displayName,
  filterOptions,
  installerName,
  permissionName,
  type TriState,
} from "../../../domain/app_query.ts";
import { appsToCsv, appsToJson } from "../../../domain/export.ts";
import { BLOAT_VERDICTS, bloatVerdict } from "../../../domain/debloat.ts";
import type { App } from "../../../domain/models.ts";
import { trackingBadge, VERDICT_TEXT } from "../debloat_text.ts";
import { formatBytes, formatDate, plural } from "../format.ts";
import {
  apps,
  appsError,
  appsStatus,
  backup,
  batchAction,
  currentDevice,
  debloatStatus,
  debloatUpdating,
  detailsPackage,
  enableBloatwareHints,
  filter,
  loadMetadata,
  metadataLoaded,
  metadataLoading,
  refreshApps,
  selection,
  serial,
  settings,
  updateBloatwareList,
  updateFilter,
  visibleApps,
} from "../state.ts";
import { AppDetailsPanel } from "./AppDetails.tsx";
import { AppIcon } from "./AppIcon.tsx";

const KINDS: [AppKind, string][] = [["user", "Installed by you"], ["system", "System"], [
  "updated-system",
  "Updated system",
], ["all", "All"]];
const STATES: [AppState, string][] = [["all", "Any"], ["enabled", "Enabled"], ["disabled", "Disabled"], [
  "not-installed",
  "Uninstalled, data kept",
]];
const SORTS: [AppSort, string][] = [
  ["name", "Name"],
  ["package", "Package"],
  ["updated", "Last updated"],
  ["installed", "First installed"],
  ["size", "Size"],
  ["target-sdk", "Target SDK"],
];

function Segmented<T extends string>(
  { label, options, value, onChange }: {
    label: string;
    options: [T, string][];
    value: T;
    onChange: (value: T) => void;
  },
) {
  return (
    <fieldset class="filter-group">
      <legend>{label}</legend>
      {options.map(([key, text]) => (
        <label key={key} class="radio-row">
          <input type="radio" name={label} checked={value === key} onChange={() => onChange(key)} />
          {text}
        </label>
      ))}
    </fieldset>
  );
}

function TriSelect(
  { label, value, onChange, disabled }: {
    label: string;
    value: TriState;
    onChange: (value: TriState) => void;
    disabled: boolean;
  },
) {
  return (
    <label class="filter-select">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.currentTarget.value as TriState)}>
        <option value="any">Any</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}

function Filters() {
  const f = filter.value;
  const options = useMemo(() => filterOptions(apps.value), [apps.value]);
  const needsMetadata = !metadataLoaded.value;
  return (
    <aside class="filters" aria-label="Filters">
      <Segmented label="Apps" options={KINDS} value={f.kind} onChange={(kind) => updateFilter({ kind })} />
      <Segmented
        label="State"
        options={STATES}
        value={f.state}
        onChange={(state) => updateFilter({ state })}
      />
      <label class="filter-select">
        <span>Installed from</span>
        <select
          value={f.installer ?? "*"}
          onChange={(e) =>
            updateFilter({ installer: e.currentTarget.value === "*" ? null : e.currentTarget.value })}
        >
          <option value="*">Anywhere</option>
          {options.installers.map((i) => <option key={i ?? ""} value={i ?? ""}>{installerName(i)}</option>)}
        </select>
      </label>
      <label class="filter-select">
        <span>Bloatware</span>
        <select
          value={f.debloat}
          disabled={!settings.value?.bloatwareHints}
          title={settings.value?.bloatwareHints ? undefined : "Turn on bloatware hints in Settings"}
          onChange={(e) => updateFilter({ debloat: e.currentTarget.value as DebloatFilter })}
        >
          <option value="any">Any</option>
          <option value="listed">On the bloatware list</option>
          {BLOAT_VERDICTS.map((verdict) => (
            <option key={verdict} value={verdict}>{VERDICT_TEXT[verdict].badge}</option>
          ))}
          <option value="tracking">Tracking or ads</option>
        </select>
      </label>
      <div class="filter-group">
        <p class="filter-note">{needsMetadata ? "Load names and icons to use these filters." : "Details"}</p>
        <label class="filter-select">
          <span>Has permission</span>
          <select
            value={f.grantedPermission ?? ""}
            disabled={needsMetadata}
            onChange={(e) => updateFilter({ grantedPermission: e.currentTarget.value || null })}
          >
            <option value="">Any</option>
            {options.permissions.map((p) => <option key={p} value={p}>{permissionName(p)}</option>)}
          </select>
        </label>
        <TriSelect
          label="Split APKs"
          value={f.split}
          disabled={needsMetadata}
          onChange={(split) => updateFilter({ split })}
        />
        <TriSelect
          label="Has launcher icon"
          value={f.launchable}
          disabled={needsMetadata}
          onChange={(launchable) => updateFilter({ launchable })}
        />
        <TriSelect
          label="Debuggable"
          value={f.debuggable}
          disabled={needsMetadata}
          onChange={(debuggable) => updateFilter({ debuggable })}
        />
      </div>
    </aside>
  );
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Toolbar({ list }: { list: App[] }) {
  const f = filter.value;
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key === "/" && !["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) {
        event.preventDefault();
        search.current?.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  const stamp = new Date().toISOString().slice(0, 10);
  const model = (currentDevice.value?.model ?? "phone").replace(/\W+/g, "-");
  return (
    <div class="toolbar">
      <input
        ref={search}
        type="search"
        class="search"
        placeholder="Search name, package, version, installer or permission"
        aria-label="Search apps"
        aria-keyshortcuts="/"
        title="Press / to search"
        value={f.query}
        onInput={(e) => updateFilter({ query: e.currentTarget.value })}
      />
      <label class="sort">
        <span class="visually-hidden">Sort by</span>
        <select value={f.sort} onChange={(e) => updateFilter({ sort: e.currentTarget.value as AppSort })}>
          {SORTS.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
        </select>
      </label>
      <button
        type="button"
        class="icon-button"
        aria-label={f.descending ? "Sorted descending" : "Sorted ascending"}
        title="Reverse order"
        onClick={() => updateFilter({ descending: !f.descending })}
      >
        {f.descending ? "↓" : "↑"}
      </button>
      {!metadataLoaded.value && (
        <button type="button" disabled={metadataLoading.value} onClick={loadMetadata}>
          {metadataLoading.value ? "Loading names and icons…" : "Load names and icons"}
        </button>
      )}
      <button type="button" onClick={refreshApps} title="Reload the app list">Refresh</button>
      <details class="menu">
        <summary>Export</summary>
        <div class="menu-items">
          <button
            type="button"
            onClick={() => download(`apps-${model}-${stamp}.csv`, appsToCsv(list), "text/csv")}
          >
            CSV ({plural(list.length, "app")})
          </button>
          <button
            type="button"
            onClick={() => download(`apps-${model}-${stamp}.json`, appsToJson(list), "application/json")}
          >
            JSON ({plural(list.length, "app")})
          </button>
        </div>
      </details>
    </div>
  );
}

/** Offers bloatware hints until they are on; shows download progress and failures after that. */
function HintsPrompt() {
  const status = debloatStatus.value;
  if (debloatUpdating.value) return <span class="muted">Downloading the bloatware list…</span>;
  if (!settings.value?.bloatwareHints) {
    return (
      <span class="hints-prompt">
        <button type="button" class="link" onClick={enableBloatwareHints}>
          Show which apps are bloatware
        </button>
        <span class="muted">
          (uses the community list from Universal Android Debloater, downloaded from GitHub)
        </span>
      </span>
    );
  }
  if (status && status.packages === 0) {
    return (
      <span class="error">
        The bloatware list is not downloaded yet{status.error ? `: ${status.error}` : ""}.{" "}
        <button type="button" class="link" onClick={updateBloatwareList}>Try again</button>
      </span>
    );
  }
  return null;
}

function Badges({ app }: { app: App }) {
  const meta = app.metadata;
  const verdict = bloatVerdict(app.debloat, app.system);
  return (
    <span class="badges">
      {!app.installed && <span class="badge badge-warn">uninstalled</span>}
      {app.installed && !app.enabled && <span class="badge badge-warn">disabled</span>}
      {app.system && <span class="badge">{meta?.updatedSystem ? "system, updated" : "system"}</span>}
      {meta && meta.splitCount > 0 && <span class="badge">{meta.splitCount + 1} APKs</span>}
      {meta?.debuggable && <span class="badge badge-accent">debuggable</span>}
      {verdict && (
        <span class={`badge debloat-${verdict}`} title={VERDICT_TEXT[verdict].summary}>
          {VERDICT_TEXT[verdict].badge}
        </span>
      )}
      {app.debloat?.tracking && (
        <span class="badge debloat-tracking" title={app.debloat.tracking.evidence}>
          {trackingBadge(app.debloat)}
        </span>
      )}
    </span>
  );
}

function AppRow({ app, device, selected }: { app: App; device: string; selected: boolean }) {
  const toggle = () => {
    const next = new Set(selection.value);
    if (selected) next.delete(app.packageName);
    else next.add(app.packageName);
    selection.value = next;
  };
  const size = app.sizes ? app.sizes.appBytes + app.sizes.dataBytes + app.sizes.cacheBytes : null;
  return (
    <li
      class={`app-row${detailsPackage.value === app.packageName ? " active" : ""}${
        selected ? " selected" : ""
      }`}
      onClick={() => (detailsPackage.value = app.packageName)}
    >
      <input
        type="checkbox"
        class="row-check"
        aria-label={`Select ${displayName(app)}`}
        checked={selected}
        onClick={(e) => e.stopPropagation()}
        onChange={toggle}
      />
      <AppIcon serial={device} app={app} />
      <button type="button" class="app-name" onClick={() => (detailsPackage.value = app.packageName)}>
        <span class="label">{app.metadata?.label ?? app.packageName}</span>
        {app.metadata && <span class="package">{app.packageName}</span>}
      </button>
      <span class="version" title={`Version code ${app.versionCode}`}>
        {app.metadata?.versionName ?? app.versionCode}
      </span>
      <span class="installer" title={app.installer ?? "Unknown installer"}>
        {installerName(app.installer)}
      </span>
      <span class="size">{formatBytes(size)}</span>
      <span class="updated">{formatDate(app.metadata?.lastUpdateTime)}</span>
      <Badges app={app} />
    </li>
  );
}

function SelectionBar({ list }: { list: App[] }) {
  const chosen = [...selection.value];
  if (chosen.length === 0) return null;
  const byName = new Map(list.map((a) => [a.packageName, a]));
  const hasDisabled = chosen.some((p) => byName.get(p) && !byName.get(p)!.enabled);
  return (
    <div class="selection-bar" role="region" aria-label="Selected apps">
      <strong>{plural(chosen.length, "app")} selected</strong>
      <button type="button" class="primary" onClick={() => backup(chosen)}>Back up</button>
      {hasDisabled && <button type="button" onClick={() => batchAction("enable", chosen)}>Enable</button>}
      <button type="button" onClick={() => batchAction("disable", chosen)}>Disable</button>
      <button type="button" onClick={() => batchAction("force-stop", chosen)}>Force stop</button>
      <button type="button" class="danger" onClick={() => batchAction("uninstall", chosen)}>Uninstall</button>
      <button type="button" class="link" onClick={() => (selection.value = new Set())}>
        Clear selection
      </button>
    </div>
  );
}

export function AppsView() {
  const device = serial.value!;
  const list = visibleApps.value;
  const total = apps.value.length;
  const allSelected = list.length > 0 && list.every((a) => selection.value.has(a.packageName));
  const details = list.find((a) => a.packageName === detailsPackage.value) ??
    apps.value.find((a) => a.packageName === detailsPackage.value);
  return (
    <div class={`apps-view${details ? " with-details" : ""}`}>
      <Filters />
      <section class="apps-main" aria-label="Apps">
        <Toolbar list={list} />
        {appsStatus.value === "loading" && <p class="empty">Reading the app list from the phone…</p>}
        {appsStatus.value === "error" && (
          <p class="empty error">
            Could not read apps: {appsError.value}{" "}
            <button type="button" onClick={refreshApps}>Try again</button>
          </p>
        )}
        {appsStatus.value === "ready" && (
          <>
            <div class="list-head">
              <input
                type="checkbox"
                class="row-check"
                aria-label="Select all shown apps"
                checked={allSelected}
                onChange={() => {
                  const next = new Set(selection.value);
                  list.forEach((a) => (allSelected ? next.delete(a.packageName) : next.add(a.packageName)));
                  selection.value = next;
                }}
              />
              <span class="list-count">
                {list.length === total ? plural(total, "app") : `${list.length} of ${plural(total, "app")}`}
              </span>
              {!metadataLoaded.value && total > 0 && (
                <span class="muted">
                  Names, icons and sizes come from a small helper that runs on the phone.
                </span>
              )}
              <HintsPrompt />
            </div>
            {list.length === 0
              ? (
                <p class="empty">
                  No apps match these filters.{" "}
                  <button
                    type="button"
                    class="link"
                    onClick={() => updateFilter({ ...resetFilter(filter.value) })}
                  >
                    Reset filters
                  </button>
                </p>
              )
              : (
                <ul class="app-list">
                  {list.map((app) => (
                    <AppRow
                      key={app.packageName}
                      app={app}
                      device={device}
                      selected={selection.value.has(app.packageName)}
                    />
                  ))}
                </ul>
              )}
          </>
        )}
        <SelectionBar list={apps.value} />
      </section>
      {details && <AppDetailsPanel key={details.packageName} app={details} />}
    </div>
  );
}

function resetFilter(current: AppFilter): Partial<AppFilter> {
  return {
    query: "",
    kind: "all",
    state: "all",
    installer: null,
    split: "any",
    debuggable: "any",
    launchable: "any",
    grantedPermission: null,
    debloat: "any",
    sort: current.sort,
    descending: current.descending,
  };
}
