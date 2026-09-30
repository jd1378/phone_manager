import { installerName } from "./app_query.ts";
import type { App } from "./models.ts";

const COLUMNS: [string, (app: App) => string | number | boolean | null | undefined][] = [
  ["package", (a) => a.packageName],
  ["label", (a) => a.metadata?.label],
  ["versionName", (a) => a.metadata?.versionName],
  ["versionCode", (a) => a.versionCode],
  ["installer", (a) => installerName(a.installer)],
  ["system", (a) => a.system],
  ["enabled", (a) => a.enabled],
  ["installed", (a) => a.installed],
  ["targetSdk", (a) => a.metadata?.targetSdk],
  ["firstInstall", (a) => a.metadata ? new Date(a.metadata.firstInstallTime).toISOString() : null],
  ["lastUpdate", (a) => a.metadata ? new Date(a.metadata.lastUpdateTime).toISOString() : null],
  ["appBytes", (a) => a.sizes?.appBytes],
  ["dataBytes", (a) => a.sizes?.dataBytes],
];

function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Spreadsheets execute cells starting with these; prefix to keep them inert.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function appsToCsv(apps: readonly App[]): string {
  const rows = [COLUMNS.map(([name]) => name).join(",")];
  for (const app of apps) rows.push(COLUMNS.map(([, get]) => csvCell(get(app))).join(","));
  return rows.join("\r\n") + "\r\n";
}

export function appsToJson(apps: readonly App[]): string {
  return JSON.stringify(Object.fromEntries(apps.map((app) => [app.packageName, app])), null, 2);
}
