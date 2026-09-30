import { batch, computed, effect, signal } from "@preact/signals";
import { type AppFilter, DEFAULT_FILTER, displayName, queryApps } from "../../domain/app_query.ts";
import { type DebloatStatus, isRiskyToRemove } from "../../domain/debloat.ts";
import { removalWarning, VERDICT_TEXT } from "./debloat_text.ts";
import type { App, AppAction, Device, DeviceInfo, LibraryEntry, Settings } from "../../domain/models.ts";
import { api, ApiError, type InstallChoice, type Job, type LibraryPick, type PublicUpload } from "./api.ts";

// ---- persisted view preferences (per browser; losing them is harmless) ----
function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`pm.${key}`);
    return raw === null ? fallback : { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}
function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(`pm.${key}`, JSON.stringify(value));
  } catch {
    // storage unavailable
  }
}

// ---- state ----
export const devices = signal<Device[]>([]);
export const serial = signal<string | null>(loadPref("device", { serial: null as string | null }).serial);
export const deviceInfo = signal<DeviceInfo | null>(null);
export const user = signal(0);
export const settings = signal<Settings | null>(null);
export const home = signal("");
export const adbVersion = signal("");

export const apps = signal<App[]>([]);
export const appsStatus = signal<"idle" | "loading" | "ready" | "error">("idle");
export const appsError = signal<string | null>(null);
export const metadataLoaded = signal(false);
export const metadataLoading = signal(false);
export const filter = signal<AppFilter>(loadPref("filter", DEFAULT_FILTER));
export const selection = signal<ReadonlySet<string>>(new Set());
export const detailsPackage = signal<string | null>(null);

export const debloatStatus = signal<DebloatStatus | null>(null);
export const debloatUpdating = signal(false);

export const library = signal<LibraryEntry[]>([]);
export const libraryStatus = signal<"idle" | "loading" | "ready" | "error">("idle");
export const jobs = signal<Job[]>([]);
export const tab = signal<"apps" | "library">("apps");
export const dialog = signal<"settings" | "pair" | null>(null);
export const logcatPackage = signal<string | null>(null);

export interface PendingUpload {
  key: string;
  name: string;
  progress: number;
  upload: PublicUpload | null;
  error: string | null;
}
export interface InstallDraft {
  uploads: PendingUpload[];
  library: LibraryPick[];
}
export const installDraft = signal<InstallDraft | null>(null);

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "error";
}
export const toasts = signal<Toast[]>([]);

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}
export const confirmRequest = signal<ConfirmRequest | null>(null);

export const currentDevice = computed(() => devices.value.find((d) => d.serial === serial.value) ?? null);
export const deviceReady = computed(() => currentDevice.value?.state === "device");
export const visibleApps = computed(() => queryApps(apps.value, filter.value));
export const runningJobs = computed(() => jobs.value.filter((job) => job.status === "running"));

effect(() => savePref("filter", filter.value));
effect(() => savePref("device", { serial: serial.value }));

// ---- feedback ----
let toastId = 0;
export function toast(message: string, kind: Toast["kind"] = "info") {
  const id = ++toastId;
  toasts.value = [...toasts.value.slice(-3), { id, message, kind }];
  setTimeout(() => (toasts.value = toasts.value.filter((t) => t.id !== id)), kind === "error" ? 9000 : 4000);
}

export const describeError = (error: unknown) =>
  error instanceof ApiError || error instanceof Error ? error.message : String(error);

export function confirm(request: Omit<ConfirmRequest, "resolve">): Promise<boolean> {
  return new Promise((resolve) => (confirmRequest.value = { ...request, resolve }));
}

export function updateFilter(patch: Partial<AppFilter>) {
  filter.value = { ...filter.value, ...patch };
}

// ---- loading ----
export async function bootstrap() {
  const state = await api.state();
  batch(() => {
    settings.value = state.settings;
    home.value = state.home;
    adbVersion.value = state.adbVersion;
    jobs.value = state.jobs;
    debloatStatus.value = state.debloat;
    setDevices(state.devices);
  });
  refreshLibrary();
  const events = new EventSource("/api/events");
  events.addEventListener("devices", (event) => setDevices(JSON.parse(event.data)));
  events.addEventListener("jobs", (event) => (jobs.value = JSON.parse(event.data)));
  events.addEventListener("job", (event) => onJob(JSON.parse(event.data)));
  events.addEventListener("debloat", (event) => {
    debloatStatus.value = JSON.parse(event.data);
    refreshApps();
  });
}

function setDevices(list: Device[]) {
  devices.value = list;
  const current = list.find((d) => d.serial === serial.value);
  if (!current) {
    const ready = list.find((d) => d.state === "device");
    if (ready || !serial.value) serial.value = (ready ?? list[0])?.serial ?? null;
  }
}

// Reload device data whenever the chosen device becomes usable or the user changes.
let loadedKey = "";
effect(() => {
  const key = deviceReady.value ? `${serial.value}/${user.value}` : "";
  if (key === loadedKey) return;
  loadedKey = key;
  batch(() => {
    apps.value = [];
    selection.value = new Set();
    detailsPackage.value = null;
    deviceInfo.value = null;
    metadataLoaded.value = false;
    appsStatus.value = "idle";
  });
  if (!key) return;
  const target = serial.value!;
  api.deviceInfo(target).then((info) => {
    if (serial.value === target) deviceInfo.value = info;
  }).catch((error) => toast(`Could not read device info: ${describeError(error)}`, "error"));
  refreshApps().then(() => {
    if (settings.value?.autoLoadMetadata && !metadataLoaded.value) loadMetadata();
  });
});

export async function refreshApps() {
  const target = serial.value;
  if (!target || !deviceReady.value) return;
  appsStatus.value = apps.value.length ? "ready" : "loading";
  try {
    const result = await api.apps(target, user.value);
    if (serial.value !== target) return;
    batch(() => {
      apps.value = result.apps;
      metadataLoaded.value = result.metadataLoaded;
      appsStatus.value = "ready";
      appsError.value = null;
      const present = new Set(result.apps.map((a) => a.packageName));
      selection.value = new Set([...selection.value].filter((p) => present.has(p)));
    });
  } catch (error) {
    appsError.value = describeError(error);
    appsStatus.value = "error";
  }
}

export async function loadMetadata() {
  const target = serial.value;
  if (!target || metadataLoading.value) return;
  metadataLoading.value = true;
  try {
    const result = await api.loadMetadata(target, user.value);
    if (serial.value === target) {
      batch(() => {
        apps.value = result.apps;
        metadataLoaded.value = true;
      });
    }
  } catch (error) {
    toast(`Could not load names and icons: ${describeError(error)}`, "error");
  } finally {
    metadataLoading.value = false;
  }
}

export async function refreshLibrary() {
  libraryStatus.value = library.value.length ? "ready" : "loading";
  try {
    library.value = await api.library();
    libraryStatus.value = "ready";
  } catch (error) {
    libraryStatus.value = "error";
    toast(`Could not read the backup folder: ${describeError(error)}`, "error");
  }
}

function onJob(job: Job) {
  const previous = jobs.value.find((j) => j.id === job.id);
  jobs.value = [job, ...jobs.value.filter((j) => j.id !== job.id)];
  if (job.status === "running" || previous?.status === job.status) return;
  const failed = job.results.filter((r) => !r.ok);
  if (job.error) toast(`${job.title} failed: ${job.error}`, "error");
  else if (failed.length) toast(`${job.title}: ${failed.length} failed. See Tasks for details.`, "error");
  else toast(`${job.title}: done`);
  if (/^Back up/.test(job.title)) refreshLibrary();
  if (job.serial === serial.value) refreshApps();
}

// ---- actions ----
const DESTRUCTIVE: Partial<Record<AppAction, { title: string; body: string; label: string }>> = {
  "uninstall": {
    title: "Uninstall",
    body: "The app and its data are removed for this user.",
    label: "Uninstall",
  },
  "uninstall-keep-data": {
    title: "Uninstall, keep data",
    body:
      "The app is removed but its data stays on the phone. Reinstall it from the 'Uninstalled, data kept' filter.",
    label: "Uninstall",
  },
  "clear-data": {
    title: "Clear data",
    body: "All of the app's data, accounts and settings are deleted. This cannot be undone.",
    label: "Clear data",
  },
  "disable": {
    title: "Disable",
    body: "The app stops running and disappears from the launcher until you enable it again.",
    label: "Disable",
  },
};

function nameOf(packageName: string): string {
  const app = apps.value.find((a) => a.packageName === packageName);
  return app ? displayName(app) : packageName;
}

/** "Settings (needed), Keyboard (unsure)" for the selected packages the bloatware list calls risky. */
function riskySummary(packages: string[]): string | null {
  const risky = packages
    .map((name) => apps.value.find((a) => a.packageName === name))
    .filter((app): app is App => app !== undefined && isRiskyToRemove(app.debloat));
  if (risky.length === 0) return null;
  const listed = risky.slice(0, 8).map((app) =>
    `${displayName(app)} (${
      app.debloat!.level === "unsafe" || app.debloat!.level === "expert"
        ? VERDICT_TEXT[app.debloat!.level].badge.toLowerCase()
        : "other apps need it"
    })`
  ).join(", ");
  const more = risky.length > 8 ? ` and ${risky.length - 8} more` : "";
  return `Warning: according to the bloatware list, removing these can break your phone or other apps: ${listed}${more}.`;
}

export async function runAction(app: App, action: AppAction): Promise<boolean> {
  const target = serial.value;
  if (!target) return false;
  const danger = DESTRUCTIVE[action];
  const name = app.metadata?.label ?? app.packageName;
  const warning = removalWarning(app, action, nameOf);
  if (
    danger &&
    !(await confirm({
      title: `${danger.title} ${name}?`,
      body: warning ? `${warning}\n\n${danger.body}` : danger.body,
      confirmLabel: warning ? `${danger.label} anyway` : danger.label,
      danger: action !== "disable" || warning !== null,
    }))
  ) {
    return false;
  }
  try {
    await api.action(target, app.packageName, action, user.value);
    if (!["launch", "force-stop", "open-settings"].includes(action)) {
      toast(`${name}: ${action.replaceAll("-", " ")} done`);
      await refreshApps();
    } else if (action === "open-settings") {
      toast(`Opened App info for ${name} on the phone`);
    }
    return true;
  } catch (error) {
    toast(`${name}: ${describeError(error)}`, "error");
    return false;
  }
}

export async function batchAction(
  action: "enable" | "disable" | "uninstall" | "force-stop",
  packages: string[],
) {
  const target = serial.value;
  if (!target || packages.length === 0) return;
  const count = `${packages.length} app${packages.length === 1 ? "" : "s"}`;
  const risk = action === "uninstall" || action === "disable" ? riskySummary(packages) : null;
  const withRisk = (body: string) => risk ? `${risk}\n\n${body}` : body;
  if (
    action === "uninstall" && !(await confirm({
      title: `Uninstall ${count}?`,
      body: withRisk(
        "The apps and their data are removed for this user. System apps can be restored from 'Uninstalled, data kept'.",
      ),
      confirmLabel: risk ? "Uninstall anyway" : "Uninstall",
      danger: true,
    }))
  ) return;
  if (
    action === "disable" && !(await confirm({
      title: `Disable ${count}?`,
      body: withRisk("Disabled apps stop running until you enable them again."),
      confirmLabel: risk ? "Disable anyway" : "Disable",
      danger: risk !== null,
    }))
  ) return;
  try {
    await api.batch(target, action, packages, user.value);
    selection.value = new Set();
  } catch (error) {
    toast(describeError(error), "error");
  }
}

export async function backup(packages: string[]) {
  const target = serial.value;
  if (!target || packages.length === 0) return;
  try {
    await api.backup(target, packages, user.value);
  } catch (error) {
    toast(describeError(error), "error");
  }
}

export function installFromLibrary(picks: LibraryPick[]) {
  if (!deviceReady.value) return toast("Connect a phone first", "error");
  installDraft.value = { uploads: [], library: picks };
}

export function installFiles(files: File[]) {
  if (!deviceReady.value) return toast("Connect a phone first, then drop the files again", "error");
  const accepted = files.filter((f) => /\.(apk|apks|xapk|apkm)$/i.test(f.name));
  if (accepted.length < files.length) toast("Skipped files that are not APKs or APK bundles", "error");
  if (accepted.length === 0) return;
  const pending: PendingUpload[] = accepted.map((file, i) => ({
    key: `${Date.now()}-${i}`,
    name: file.name,
    progress: 0,
    upload: null,
    error: null,
  }));
  const draft = installDraft.value;
  installDraft.value = { uploads: [...(draft?.uploads ?? []), ...pending], library: draft?.library ?? [] };
  const patch = (key: string, change: Partial<PendingUpload>) => {
    const current = installDraft.value;
    if (!current) return;
    installDraft.value = {
      ...current,
      uploads: current.uploads.map((u) => (u.key === key ? { ...u, ...change } : u)),
    };
  };
  accepted.forEach((file, i) => {
    const { key } = pending[i];
    api.upload(file, (progress) => patch(key, { progress }))
      .then((upload) => {
        if (installDraft.value?.uploads.some((u) => u.key === key)) patch(key, { upload, progress: 1 });
        else api.deleteUpload(upload.id); // dialog was closed meanwhile
      })
      .catch((error) => patch(key, { error: describeError(error) }));
  });
}

export function closeInstall(keepUploads = false) {
  const draft = installDraft.value;
  installDraft.value = null;
  if (!keepUploads) draft?.uploads.forEach((u) => u.upload && api.deleteUpload(u.upload.id).catch(() => {}));
}

export async function startInstall(
  choice: InstallChoice,
  grantPermissions: boolean,
  allowDowngrade: boolean,
) {
  const target = serial.value;
  if (!target) return;
  try {
    await api.install(target, choice, { user: user.value, grantPermissions, allowDowngrade });
    closeInstall(true); // the server removes uploads when the install finishes
  } catch (error) {
    toast(describeError(error), "error");
  }
}

export async function deleteBackups(entries: LibraryEntry[]) {
  const what = entries.length === 1
    ? `${entries[0].label ?? entries[0].packageName} ${entries[0].versionName ?? entries[0].versionCode}`
    : `${entries.length} backups`;
  if (
    !(await confirm({
      title: `Delete ${what}?`,
      body: "The APK files are deleted from the backup folder.",
      confirmLabel: "Delete",
      danger: true,
    }))
  ) return;
  for (const entry of entries) {
    try {
      await api.deleteBackup(entry);
    } catch (error) {
      toast(describeError(error), "error");
    }
  }
  refreshLibrary();
}

export async function updateBloatwareList(): Promise<void> {
  debloatUpdating.value = true;
  try {
    debloatStatus.value = await api.updateDebloat();
    await refreshApps();
  } catch (error) {
    toast(describeError(error), "error");
  } finally {
    debloatUpdating.value = false;
  }
}

/** Turns hints on and fetches the list right away, so the badges appear without waiting. */
export async function enableBloatwareHints(): Promise<void> {
  if (await saveSettings({ bloatwareHints: true })) await updateBloatwareList();
}

export async function saveSettings(patch: Partial<Settings>): Promise<boolean> {
  try {
    const previousFolder = settings.value?.backupDirectory;
    settings.value = await api.saveSettings(patch);
    if (settings.value.backupDirectory !== previousFolder) refreshLibrary();
    return true;
  } catch (error) {
    toast(describeError(error), "error");
    return false;
  }
}
