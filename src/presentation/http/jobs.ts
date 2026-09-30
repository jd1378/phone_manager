import type { ItemResult, ProgressUpdate } from "../../domain/models.ts";
import { errorMessage } from "../../domain/use_cases/backup.ts";
import type { EventHub } from "./events.ts";

export interface Job {
  id: string;
  title: string;
  serial: string;
  status: "running" | "done" | "failed";
  progress: ProgressUpdate;
  results: ItemResult[];
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

const KEEP_FINISHED = 30;

/** Long operations run in the background; pages follow them through "job" events. */
export class JobRegistry {
  readonly #jobs = new Map<string, Job>();

  constructor(private readonly hub: EventHub) {}

  list(): Job[] {
    return [...this.#jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  start(
    title: string,
    serial: string,
    total: number,
    run: (report: (update: ProgressUpdate) => void) => Promise<ItemResult[]>,
    onFinish?: () => void,
  ): Job {
    const job: Job = {
      id: crypto.randomUUID(),
      title,
      serial,
      status: "running",
      progress: { done: 0, total, message: "Starting" },
      results: [],
      error: null,
      startedAt: Date.now(),
      finishedAt: null,
    };
    this.#jobs.set(job.id, job);
    this.#prune();
    this.hub.broadcast("job", job);
    run((update) => {
      job.progress = update;
      this.hub.broadcast("job", job);
    })
      .then((results) => {
        job.results = results;
        job.status = results.some((r) => !r.ok) ? "failed" : "done";
      })
      .catch((error) => {
        job.status = "failed";
        job.error = errorMessage(error);
      })
      .finally(() => {
        job.finishedAt = Date.now();
        this.hub.broadcast("job", job);
        onFinish?.();
      });
    return job;
  }

  #prune(): void {
    const finished = this.list().filter((job) => job.status !== "running");
    for (const job of finished.slice(KEEP_FINISHED)) this.#jobs.delete(job.id);
  }
}
