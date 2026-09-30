import { useEffect, useRef, useState } from "preact/hooks";
import { formatDateTime } from "../format.ts";
import { jobs, runningJobs } from "../state.ts";

/** Background work (backups, installs, batch actions); opens by itself when something starts. */
export function TasksMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const running = runningJobs.value.length;
  useEffect(() => {
    if (running > 0) setOpen(true);
  }, [running]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => !root.current?.contains(event.target as Node) && setOpen(false);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    addEventListener("mousedown", onDown);
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("mousedown", onDown);
      removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (jobs.value.length === 0) return null;
  return (
    <div class="tasks" ref={root}>
      <button
        type="button"
        class={running ? "tasks-toggle busy" : "tasks-toggle"}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {running ? `${running} running` : "Tasks"}
      </button>
      {open && (
        <ul class="task-list" aria-label="Tasks">
          {jobs.value.map((job) => (
            <li key={job.id} class={`task task-${job.status}`}>
              <div class="task-head">
                <strong>{job.title}</strong>
                <span class="muted">{formatDateTime(job.startedAt)}</span>
              </div>
              {job.status === "running"
                ? (
                  <>
                    <progress max={job.progress.total || 1} value={job.progress.done} />
                    <p class="muted">{job.progress.message}</p>
                  </>
                )
                : (
                  <ul class="task-results">
                    {job.error && <li class="error">{job.error}</li>}
                    {job.results.map((r, i) => (
                      <li key={i} class={r.ok ? "" : "error"}>
                        <span class="mono">{r.item}</span>: {r.message}
                      </li>
                    ))}
                  </ul>
                )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
