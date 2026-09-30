/**
 * Bloatware hints from a community list. Only packages on the list get a verdict; everything else
 * gets none, rather than a guess.
 */

/** How safe removal is, from the list maintainers' point of view. */
export type DebloatLevel =
  | "recommended" // bloatware: safe to remove
  | "advanced" // probably bloat, but removing it may lose a feature
  | "expert" // unclear: removing it can break things
  | "unsafe"; // needed: removing it breaks the phone

export type DebloatCategory = "oem" | "aosp" | "google" | "carrier" | "misc";

export interface TrackingMention {
  /** "yes" when the description states it, "maybe" when it hedges ("probably collects data"). */
  certainty: "yes" | "maybe";
  /** The clause that says so, for the user to judge. */
  evidence: string;
}

export interface DebloatEntry {
  level: DebloatLevel;
  category: DebloatCategory;
  description: string;
  /** Packages this one needs. */
  dependencies: string[];
  /** Packages that stop working without this one. */
  neededBy: string[];
  tracking: TrackingMention | null;
}

export interface DebloatSourceInfo {
  name: string;
  url: string;
  license: string;
}

export interface DebloatList {
  entries: ReadonlyMap<string, DebloatEntry>;
  updatedAt: string;
  source: DebloatSourceInfo;
}

export interface DebloatStatus {
  enabled: boolean;
  updatedAt: string | null;
  packages: number;
  source: DebloatSourceInfo;
  error: string | null;
}

/** What to tell the user: the list's level, or a softer note for copies the user may have installed. */
export type BloatVerdict = DebloatLevel | "often-preinstalled";

export const BLOAT_VERDICTS: readonly BloatVerdict[] = [
  "recommended",
  "advanced",
  "often-preinstalled",
  "expert",
  "unsafe",
];

/**
 * The list rates apps as shipped by phone makers. WhatsApp or Google Photos installed as a regular
 * app is the user's choice, not bloatware, so those only get "often preinstalled". Risk levels stay.
 */
export function bloatVerdict(entry: DebloatEntry | null, system: boolean): BloatVerdict | null {
  if (!entry) return null;
  if (!system && (entry.level === "recommended" || entry.level === "advanced")) return "often-preinstalled";
  return entry.level;
}

/** Removing these can break the phone or other apps, so removal asks for extra confirmation. */
export const isRiskyToRemove = (entry: DebloatEntry | null): boolean =>
  entry !== null && (entry.level === "expert" || entry.level === "unsafe" || entry.neededBy.length > 0);

const TRACKING =
  /\b(spyware|telemetry|tracking|trackers?|analytics|data collection|collects?|usage data|diagnostic data|advertis\w*|ads)\b/i;
// Tracking as a feature the user wants: "location tracking", "app usage tracking", "tracking your lost phone".
const FEATURE_TRACKING =
  /\b(location|asset|usage|fitness|activity|sleep|health|package|order|expense|habit)\s+tracking\b|\btracking\s+(of\s+)?your\s+(lost\s+)?(phone|device)\b/gi;
const HEDGE =
  /\b(probably|maybe|might|possibly|seems?|perhaps|not sure|unclear|suspect\w*|could|sometimes|on some)\b/i;
const NEGATED = /\b(no|not|without|never|doesn'?t|does not|isn'?t|free of)\s+(\S+\s+){0,2}$/i;
const SENTENCE_BREAK = /[.;\n!?]+\s*/;
// A contrast starts a new claim: "probably for installs, but has ads" states the ads plainly.
const CONTRAST_BREAK = /\s+but\s+|\s+\+\s+/i;

/**
 * Finds a statement that the package tracks users or shows ads. Hedges ("probably", "on some
 * phones") weaken the whole sentence; negations only the words right before the keyword.
 */
export function trackingMention(description: string): TrackingMention | null {
  let found: TrackingMention | null = null;
  for (const sentence of description.split(SENTENCE_BREAK)) {
    for (const raw of sentence.split(CONTRAST_BREAK)) {
      const part = raw.trim().replace(/[,:\s]+$/, "");
      const claims = part.replace(FEATURE_TRACKING, (phrase) => " ".repeat(phrase.length));
      for (const clause of claims.split(",")) {
        const match = clause.match(TRACKING);
        if (!match || NEGATED.test(clause.slice(0, match.index))) continue;
        const certainty = HEDGE.test(part) ? "maybe" : "yes";
        if (certainty === "yes") return { certainty, evidence: part };
        found ??= { certainty, evidence: part };
      }
    }
  }
  return found;
}
