import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { LogLine } from "../../../domain/models.ts";
import { api } from "../api.ts";
import { apps, logcatPackage, serial } from "../state.ts";
import { Dialog } from "./Dialog.tsx";

const MAX_LINES = 5000;
const LEVELS = ["V", "D", "I", "W", "E", "F"] as const;
const LEVEL_NAMES: Record<string, string> = {
  V: "Verbose",
  D: "Debug",
  I: "Info",
  W: "Warning",
  E: "Error",
  F: "Fatal",
};

export function LogcatPanel() {
  const packageName = logcatPackage.value!;
  const app = apps.value.find((a) => a.packageName === packageName);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<"live" | "ended" | "error">("live");
  const [minLevel, setMinLevel] = useState<string>("V");
  const [text, setText] = useState("");
  const [paused, setPaused] = useState(false);
  const [follow, setFollow] = useState(true);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const buffer = useRef<LogLine[]>([]);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const source = new EventSource(api.logcatUrl(serial.value!, packageName));
    source.addEventListener("lines", (event) => {
      buffer.current = [...buffer.current, ...JSON.parse((event as MessageEvent).data)].slice(-MAX_LINES);
      if (!pausedRef.current) setLines(buffer.current);
    });
    source.addEventListener("end", () => {
      setStatus("ended");
      source.close();
    });
    source.onerror = () => {
      setStatus((s) => (s === "live" ? "error" : s));
      source.close();
    };
    return () => source.close();
  }, [packageName]);

  useEffect(() => {
    if (!paused) setLines(buffer.current);
  }, [paused]);

  const shown = useMemo(() => {
    const min = LEVELS.indexOf(minLevel as typeof LEVELS[number]);
    const needle = text.toLowerCase();
    return lines.filter((l) =>
      LEVELS.indexOf(l.level as typeof LEVELS[number]) >= min &&
      (!needle || l.message.toLowerCase().includes(needle) || l.tag.toLowerCase().includes(needle))
    );
  }, [lines, minLevel, text]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [shown, follow]);

  return (
    <Dialog
      title={`Logcat: ${app?.metadata?.label ?? packageName}`}
      onClose={() => (logcatPackage.value = null)}
      wide
    >
      <div class="log-toolbar">
        <label>
          <span class="visually-hidden">Minimum level</span>
          <select value={minLevel} onChange={(e) => setMinLevel(e.currentTarget.value)}>
            {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_NAMES[l]} and above</option>)}
          </select>
        </label>
        <input
          type="search"
          placeholder="Filter by tag or text"
          aria-label="Filter log lines"
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
        />
        <button type="button" onClick={() => setPaused(!paused)} aria-pressed={paused}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          onClick={() => {
            buffer.current = [];
            setLines([]);
          }}
        >
          Clear
        </button>
        <span class="muted log-status">
          {status === "live"
            ? (paused ? "Paused" : "Live")
            : status === "ended"
            ? "Stopped: phone disconnected"
            : "Connection lost"}
          {` (${shown.length} lines)`}
        </span>
      </div>
      <div
        class="log"
        ref={scroller}
        role="log"
        aria-live="off"
        onScroll={(e) => {
          const el = e.currentTarget;
          setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
        }}
      >
        {shown.length === 0 && (
          <p class="muted">
            Waiting for log lines. Open the app on the phone; lines from its processes appear here, including
            crashes.
          </p>
        )}
        {shown.map((l, i) => (
          <div key={i} class={`log-line level-${l.level}`}>
            <span class="log-time">{l.time.slice(6)}</span>
            <span class="log-level">{l.level}</span>
            <span class="log-tag">{l.tag}</span>
            <span class="log-message">{l.message}</span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
