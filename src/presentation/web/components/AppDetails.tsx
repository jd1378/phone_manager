import { useEffect, useState } from "preact/hooks";
import { installerName, permissionName } from "../../../domain/app_query.ts";
import type { App, AppDetails } from "../../../domain/models.ts";
import { api } from "../api.ts";
import { formatBytes, formatDateTime, plural } from "../format.ts";
import {
  backup,
  describeError,
  detailsPackage,
  library,
  logcatPackage,
  runAction,
  serial,
  toast,
  user,
} from "../state.ts";
import { AppIcon } from "./AppIcon.tsx";

function Fact({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function Permissions({ app, details, onChange }: { app: App; details: AppDetails; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const runtime = details.permissions.filter((p) => p.runtime);
  const other = details.permissions.filter((p) => !p.runtime);
  const toggle = async (permission: string, granted: boolean) => {
    setBusy(permission);
    try {
      await api.permission(serial.value!, app.packageName, permission, granted, user.value);
      onChange();
    } catch (error) {
      toast(`${permissionName(permission)}: ${describeError(error)}`, "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <section class="details-section">
      <h3>Permissions</h3>
      {runtime.length === 0 && <p class="muted">No permissions that need your approval.</p>}
      <ul class="permissions">
        {runtime.map((p) => (
          <li key={p.name}>
            <label class="switch-row">
              <input
                type="checkbox"
                role="switch"
                checked={p.granted}
                disabled={busy !== null}
                onChange={(e) => toggle(p.name, e.currentTarget.checked)}
              />
              <span title={p.name}>{permissionName(p.name)}</span>
            </label>
          </li>
        ))}
      </ul>
      {other.length > 0 && (
        <details class="more">
          <summary>{plural(other.length, "other permission")} (granted at install)</summary>
          <ul class="plain-list mono">{other.map((p) => <li key={p.name}>{permissionName(p.name)}</li>)}</ul>
        </details>
      )}
    </section>
  );
}

export function AppDetailsPanel({ app }: { app: App }) {
  const device = serial.value!;
  const [details, setDetails] = useState<AppDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.details(device, app.packageName).then(setDetails, (e) => setError(describeError(e)));
  useEffect(() => {
    load();
  }, [app.packageName, app.versionCode, app.enabled]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) detailsPackage.value = null;
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const meta = details?.metadata ?? app.metadata;
  const backedUp = library.value.filter((e) => e.packageName === app.packageName);
  const hasCurrentBackup = backedUp.some((e) => e.versionCode === app.versionCode);
  const act = (action: Parameters<typeof runAction>[1]) => runAction(app, action);

  return (
    <aside class="details" aria-label={`${meta?.label ?? app.packageName} details`}>
      <header class="details-head">
        <AppIcon serial={device} app={app} size={48} />
        <div class="details-title">
          <h2>{meta?.label ?? app.packageName}</h2>
          <p class="mono">{app.packageName}</p>
        </div>
        <button
          type="button"
          class="icon-button"
          aria-label="Close details"
          onClick={() => (detailsPackage.value = null)}
        >
          ✕
        </button>
      </header>

      <div class="details-actions">
        {app.installed
          ? (
            <>
              <button
                type="button"
                class="primary"
                onClick={() => backup([app.packageName])}
                disabled={hasCurrentBackup}
              >
                {hasCurrentBackup ? "Backed up" : "Back up APK"}
              </button>
              {meta?.launchable !== false && app.enabled && (
                <button
                  type="button"
                  onClick={() => act("launch")}
                >
                  Open
                </button>
              )}
              <button type="button" onClick={() => act("force-stop")}>Force stop</button>
              <button type="button" onClick={() => (logcatPackage.value = app.packageName)}>Logcat</button>
              <button
                type="button"
                onClick={() => act("open-settings")}
                title="Opens this app's App info screen on the phone"
              >
                App info on phone
              </button>
              {app.enabled
                ? <button type="button" onClick={() => act("disable")}>Disable</button>
                : <button type="button" onClick={() => act("enable")}>Enable</button>}
              <button type="button" class="danger-quiet" onClick={() => act("clear-data")}>Clear data</button>
              <button type="button" class="danger-quiet" onClick={() => act("uninstall-keep-data")}>
                Uninstall, keep data
              </button>
              <button type="button" class="danger" onClick={() => act("uninstall")}>Uninstall</button>
            </>
          )
          : (
            <button type="button" class="primary" onClick={() => act("reinstall-existing")}>
              Reinstall for this user
            </button>
          )}
      </div>

      {error && <p class="error">{error}</p>}
      <section class="details-section">
        <dl class="facts">
          <Fact label="Version">
            {meta?.versionName ?? "unknown"} <span class="muted">({app.versionCode})</span>
          </Fact>
          <Fact label="Installed from">{installerName(details?.installer ?? app.installer)}</Fact>
          {meta && (
            <Fact label="Android API">
              target {meta.targetSdk}
              {meta.minSdk !== null && `, min ${meta.minSdk}`}
            </Fact>
          )}
          {meta && <Fact label="First installed">{formatDateTime(meta.firstInstallTime)}</Fact>}
          {meta && <Fact label="Last updated">{formatDateTime(meta.lastUpdateTime)}</Fact>}
          {app.sizes && (
            <Fact label="Storage">
              {formatBytes(app.sizes.appBytes)} app, {formatBytes(app.sizes.dataBytes)} data,{" "}
              {formatBytes(app.sizes.cacheBytes)} cache
            </Fact>
          )}
          {details && <Fact label="User ID">{details.uid}</Fact>}
          {backedUp.length > 0 && (
            <Fact label="Backups">{backedUp.map((e) => e.versionName ?? e.versionCode).join(", ")}</Fact>
          )}
        </dl>
      </section>

      {details && (
        <>
          <Permissions app={app} details={details} onChange={load} />
          <section class="details-section">
            <h3>Files</h3>
            <ul class="plain-list mono">{details.apkPaths.map((p) => <li key={p}>{p}</li>)}</ul>
            {details.dataDir && <p class="mono muted">{details.dataDir}</p>}
            {details.signers.length > 0 && (
              <>
                <h3>Signing certificate (SHA-256)</h3>
                {details.signers.map((s) => <p key={s} class="mono break">{s}</p>)}
              </>
            )}
          </section>
        </>
      )}
      {!details && !error && <p class="muted details-section">Reading details from the phone…</p>}
    </aside>
  );
}
