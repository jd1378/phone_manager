import type { BloatVerdict, DebloatEntry } from "../../domain/debloat.ts";
import { displayName } from "../../domain/app_query.ts";
import type { App, AppAction } from "../../domain/models.ts";

export const VERDICT_TEXT: Record<BloatVerdict, { badge: string; summary: string }> = {
  recommended: {
    badge: "Bloatware",
    summary: "Bloatware. Safe to remove: the rest of the phone does not depend on it.",
  },
  advanced: {
    badge: "Likely bloatware",
    summary: "Probably bloatware. Usually safe to remove, but you may lose a feature it provides.",
  },
  "often-preinstalled": {
    badge: "Often preinstalled",
    summary:
      "Phone makers often preinstall this app as bloatware. If you installed it yourself and use it, ignore this.",
  },
  expert: {
    badge: "Unsure",
    summary:
      "Not clear-cut. Removing it can break features or other apps; only remove it if you know what it does.",
  },
  unsafe: {
    badge: "Needed",
    summary: "Needed by the system. Removing it can break your phone, up to a boot loop that needs a reset.",
  },
};

export const trackingBadge = (entry: DebloatEntry) =>
  entry.tracking?.certainty === "yes" ? "Tracking or ads" : "Maybe tracking";

const REMOVING: Partial<Record<AppAction, string>> = {
  "uninstall": "Uninstalling",
  "uninstall-keep-data": "Uninstalling",
  "disable": "Disabling",
  "clear-data": "Clearing the data of",
};

const shorten = (text: string, max = 360) => text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;

/** Extra warning for removing a package the list marks as risky; null when there is nothing to add. */
export function removalWarning(
  app: App,
  action: AppAction,
  installedNames: (name: string) => string,
): string | null {
  const entry = app.debloat;
  const verb = REMOVING[action];
  if (!entry || !verb || action === "clear-data" && entry.level !== "unsafe") return null;
  const parts: string[] = [];
  if (entry.level === "unsafe") {
    parts.push(
      `${verb} ${
        displayName(app)
      } can break your phone: the bloatware list marks it as needed by the system.`,
    );
  } else if (entry.level === "expert") {
    parts.push(
      `The bloatware list is unsure about ${displayName(app)}: removing it can break features or other apps.`,
    );
  }
  if (entry.neededBy.length > 0) {
    parts.push(`These need it: ${entry.neededBy.slice(0, 6).map(installedNames).join(", ")}.`);
  }
  if (parts.length === 0) return null;
  if (entry.description) parts.push(`List notes: ${shorten(entry.description.replace(/\s+/g, " "))}`);
  return parts.join(" ");
}
