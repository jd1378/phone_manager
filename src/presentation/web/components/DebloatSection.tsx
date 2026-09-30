import { displayName } from "../../../domain/app_query.ts";
import { bloatVerdict } from "../../../domain/debloat.ts";
import type { App } from "../../../domain/models.ts";
import { trackingBadge, VERDICT_TEXT } from "../debloat_text.ts";
import { apps, debloatStatus } from "../state.ts";

const nameOf = (packageName: string) => {
  const app = apps.value.find((a) => a.packageName === packageName);
  return app ? displayName(app) : packageName;
};

/** What the bloatware list says about this app. Renders nothing for apps not on the list. */
export function DebloatSection({ app }: { app: App }) {
  const entry = app.debloat;
  if (!entry) return null;
  const source = debloatStatus.value?.source;
  const verdict = bloatVerdict(entry, app.system)!;
  return (
    <section
      class={`details-section debloat-section debloat-section-${entry.level}`}
      aria-label="Bloatware list"
    >
      <h3>
        Bloatware list <span class={`badge debloat-${verdict}`}>{VERDICT_TEXT[verdict].badge}</span>{" "}
        {entry.tracking && <span class="badge debloat-tracking">{trackingBadge(entry)}</span>}
      </h3>
      <p>{VERDICT_TEXT[verdict].summary}</p>
      {entry.neededBy.length > 0 && (
        <p>
          <strong>Needed by:</strong> {entry.neededBy.map(nameOf).join(", ")}
        </p>
      )}
      {entry.tracking && (
        <p>
          {entry.tracking.certainty === "yes"
            ? "The list says it tracks you or shows ads"
            : "The list suspects tracking"}: <q>{entry.tracking.evidence}</q>
        </p>
      )}
      {entry.description && <p class="debloat-notes">{entry.description}</p>}
      {entry.dependencies.length > 0 && (
        <p class="muted">Depends on: {entry.dependencies.map(nameOf).join(", ")}</p>
      )}
      <p class="muted">
        Community-maintained:{" "}
        {source ? `${source.name} (${source.license})` : "bloatware list"}. Check before removing anything.
      </p>
    </section>
  );
}
