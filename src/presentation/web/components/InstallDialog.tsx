import { useEffect, useState } from "preact/hooks";
import type { InstallWarning } from "../../../domain/install_plan.ts";
import { api, type PublicGroup } from "../api.ts";
import { formatBytes, plural } from "../format.ts";
import {
  closeInstall,
  currentDevice,
  describeError,
  installDraft,
  serial,
  startInstall,
  user,
} from "../state.ts";
import { Dialog } from "./Dialog.tsx";

function warningText(warning: InstallWarning): string {
  switch (warning.kind) {
    case "downgrade":
      return `Older than the installed version (${warning.installedVersionCode}). Needs "Allow downgrade", which usually only works for debuggable apps.`;
    case "reinstall":
      return "This exact version is already installed; it will be reinstalled and keep its data.";
    case "min-sdk":
      return `Needs Android API ${warning.minSdk}, but this phone has API ${warning.deviceSdk}. It will not install.`;
    case "signer-mismatch":
      return "Signed with a different key than the installed app. The install will fail unless you uninstall the app first, which deletes its data.";
    case "missing-base":
      return "Only split APKs were added, without the base APK. Add the base APK too.";
    case "unreadable":
      return `${warning.fileName} could not be read as an APK. adb will try anyway.`;
  }
}

const BLOCKING = new Set<InstallWarning["kind"]>(["min-sdk", "missing-base"]);

export function InstallDialog() {
  const draft = installDraft.value!;
  const [plan, setPlan] = useState<PublicGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grant, setGrant] = useState(false);
  const [downgrade, setDowngrade] = useState(false);
  const [starting, setStarting] = useState(false);

  const uploading = draft.uploads.filter((u) => !u.upload && !u.error);
  const failed = draft.uploads.filter((u) => u.error);
  const uploadIds = draft.uploads.flatMap((u) => (u.upload ? [u.upload.id] : []));
  const choice = { uploads: uploadIds, library: draft.library };
  const ready = uploading.length === 0 && (uploadIds.length > 0 || draft.library.length > 0);

  useEffect(() => {
    if (!ready) return;
    setPlan(null);
    setError(null);
    api.installPlan(serial.value!, choice, user.value).then(setPlan, (e) => setError(describeError(e)));
  }, [ready, uploadIds.join(), draft.library.map((p) => `${p.packageName}@${p.versionCode}`).join()]);

  const needsDowngrade = plan?.some((g) => g.warnings.some((w) => w.kind === "downgrade")) ?? false;
  const installable = plan?.filter((g) => !g.warnings.some((w) => BLOCKING.has(w.kind))) ?? [];

  return (
    <Dialog
      title={`Install on ${currentDevice.value?.model ?? "phone"}`}
      onClose={() => closeInstall()}
      wide
    >
      <div class="dialog-body">
        {draft.uploads.length > 0 && (uploading.length > 0 || failed.length > 0) && (
          <ul class="uploads">
            {draft.uploads.map((u) => (
              <li key={u.key}>
                <span class="mono">{u.name}</span>
                {u.error
                  ? <span class="error">{u.error}</span>
                  : u.upload
                  ? <span class="muted">ready</span>
                  : <progress max={1} value={u.progress} aria-label={`Uploading ${u.name}`} />}
              </li>
            ))}
          </ul>
        )}
        {ready && !plan && !error && <p class="muted">Checking the APKs against the phone…</p>}
        {error && <p class="error">{error}</p>}
        {plan && (
          <ul class="plan">
            {plan.map((group, i) => {
              const size = group.files.reduce((sum, f) => sum + f.size, 0);
              return (
                <li key={i} class="plan-group">
                  <div class="plan-title">
                    <strong>{group.label ?? group.packageName ?? group.files[0].name}</strong>
                    {group.versionName && <span>{group.versionName}</span>}
                    {group.versionCode !== null && <span class="muted">({group.versionCode})</span>}
                  </div>
                  {group.packageName && group.label && <p class="mono muted">{group.packageName}</p>}
                  <p class="muted">
                    {group.files.length === 1 ? group.files[0].name : plural(group.files.length, "APK")},{" "}
                    {formatBytes(size)}
                  </p>
                  {group.warnings.length > 0 && (
                    <ul class="warnings">
                      {group.warnings.map((w, j) => (
                        <li
                          key={j}
                          class={BLOCKING.has(w.kind) || w.kind === "signer-mismatch"
                            ? "warning strong"
                            : "warning"}
                        >
                          {warningText(w)}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <fieldset class="options">
          <legend class="visually-hidden">Install options</legend>
          <label class="check-row">
            <input type="checkbox" checked={grant} onChange={(e) => setGrant(e.currentTarget.checked)} />
            Grant all runtime permissions
          </label>
          <label class="check-row">
            <input
              type="checkbox"
              checked={downgrade}
              onChange={(e) => setDowngrade(e.currentTarget.checked)}
            />
            Allow downgrade {needsDowngrade && <span class="muted">(needed for an older version)</span>}
          </label>
        </fieldset>
      </div>
      <footer class="dialog-actions">
        <button type="button" onClick={() => closeInstall()}>Cancel</button>
        <button
          type="button"
          class="primary"
          disabled={!plan || installable.length === 0 || starting}
          onClick={async () => {
            setStarting(true);
            await startInstall(choice, grant, downgrade);
            setStarting(false);
          }}
        >
          {plan && plan.length > 1 ? `Install ${plan.length} apps` : "Install"}
        </button>
      </footer>
    </Dialog>
  );
}
