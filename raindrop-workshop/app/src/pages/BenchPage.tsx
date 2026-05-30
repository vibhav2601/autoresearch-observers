import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { postBenchRun, type BenchObserverMode, type BenchProgressEvent, type BenchTotals } from "../api/bench";
import { useWorkshopEvent } from "../hooks/use-workshop-ws";
import { runPath } from "../utils/navigation";
import { C } from "../utils/colors";

interface ColumnState {
  benchId: string | null;
  observer: BenchObserverMode;
  status: "idle" | "starting" | "running" | "done" | "error";
  runId: string | null;
  totals: BenchTotals;
  durationMs: number | null;
  exitCode: number | null;
  message: string | null;
}

const EMPTY_TOTALS: BenchTotals = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  costUsd: 0,
  steps: 0,
};

function blankColumn(observer: BenchObserverMode): ColumnState {
  return {
    benchId: null,
    observer,
    status: "idle",
    runId: null,
    totals: { ...EMPTY_TOTALS },
    durationMs: null,
    exitCode: null,
    message: null,
  };
}

const DEFAULT_PROMPT = `Read the local file research_brief.md, then summarize the three most important facts you can verify from facts.md. If a claim in obsolete_notes.md contradicts facts.md, prefer facts.md and explain why.`;

export function BenchPage() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [model, setModel] = useState("openai/gpt-4o-mini");
  const [cwd, setCwd] = useState("scenarios/hallucinating-subagents/fixture-repo");
  const [off, setOff] = useState<ColumnState>(() => blankColumn("off"));
  const [on, setOn] = useState<ColumnState>(() => blankColumn("on"));

  // Pre-POST events arrive before the column knows its benchId. Buffer them
  // by benchId and apply once the column registers.
  const pending = useRef<Map<string, BenchProgressEvent[]>>(new Map());

  const applyEventToState = (prev: ColumnState, event: BenchProgressEvent): ColumnState => {
    const next: ColumnState = { ...prev };
    switch (event.type) {
      case "started":
        next.status = "running";
        next.message = event.message ?? null;
        break;
      case "session":
        if (event.runId) next.runId = event.runId;
        break;
      case "progress":
        next.status = "running";
        if (event.totals) next.totals = event.totals;
        if (event.runId && !next.runId) next.runId = event.runId;
        break;
      case "done":
        next.status = "done";
        if (event.totals) next.totals = event.totals;
        if (typeof event.durationMs === "number") next.durationMs = event.durationMs;
        if (typeof event.exitCode === "number") next.exitCode = event.exitCode;
        break;
      case "error":
        next.status = "error";
        next.message = event.message ?? "error";
        if (event.totals) next.totals = event.totals;
        if (typeof event.durationMs === "number") next.durationMs = event.durationMs;
        break;
    }
    return next;
  };

  const updateForBench = useCallback((event: BenchProgressEvent) => {
    const setter = event.observer === "off" ? setOff : setOn;
    setter((prev) => {
      if (prev.benchId !== event.benchId) {
        // Buffer until the column adopts this benchId.
        const list = pending.current.get(event.benchId) ?? [];
        list.push(event);
        pending.current.set(event.benchId, list);
        return prev;
      }
      return applyEventToState(prev, event);
    });
  }, []);

  useWorkshopEvent("bench_event", updateForBench);

  const launch = useCallback(async (observer: BenchObserverMode) => {
    const setter = observer === "off" ? setOff : setOn;
    setter({ ...blankColumn(observer), status: "starting" });
    try {
      const res = await postBenchRun({ prompt, observer, cwd, model });
      setter((prev) => {
        const buffered = pending.current.get(res.benchId) ?? [];
        pending.current.delete(res.benchId);
        let next: ColumnState = { ...prev, benchId: res.benchId, status: "running" };
        for (const event of buffered) next = applyEventToState(next, event);
        return next;
      });
    } catch (err) {
      setter((prev) => ({ ...prev, status: "error", message: err instanceof Error ? err.message : String(err) }));
    }
  }, [prompt, cwd, model]);

  const busy = off.status === "starting" || off.status === "running" || on.status === "starting" || on.status === "running";

  return (
    <div className="flex h-full flex-col" style={{ background: C.bg }}>
      <div className="flex flex-col gap-3 px-6 py-4" style={{ borderBottom: `1px solid ${C.border}` }}>
        <div>
          <div className="text-[10px] uppercase tracking-wide font-medium" style={{ color: C.fg0 }}>Observer benchmark</div>
          <div className="text-[18px] font-semibold" style={{ color: C.fg4 }}>Compare worker runs with the observer ON vs OFF.</div>
          <div className="text-[12px] mt-1" style={{ color: C.fg1 }}>
            Each click spawns one OpenCode worker. OFF runs are tagged so the local observer ignores them; ON runs feed the observer normally.
            Live tokens, cost, and wall-clock fill in below as each run streams.
          </div>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          placeholder="Worker prompt..."
          className="rounded p-3 font-mono text-[12px] leading-relaxed"
          style={{ background: "rgba(255,255,255,0.04)", color: C.fg4, border: `1px solid ${C.border}` }}
        />
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-[11px]" style={{ color: C.fg1 }}>
            cwd
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              className="ml-2 rounded px-2 py-1 text-[11px] font-mono"
              style={{ background: "rgba(255,255,255,0.04)", color: C.fg4, border: `1px solid ${C.border}`, width: 360 }}
            />
          </label>
          <label className="text-[11px]" style={{ color: C.fg1 }}>
            model
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="ml-2 rounded px-2 py-1 text-[11px] font-mono"
              style={{ background: "rgba(255,255,255,0.04)", color: C.fg4, border: `1px solid ${C.border}`, width: 220 }}
            />
          </label>
          <div className="flex-1" />
          <button
            onClick={() => launch("off")}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              background: busy ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.10)",
              color: busy ? C.fg0 : C.fg4,
              border: `1px solid ${C.border}`,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            Run with observer OFF
          </button>
          <button
            onClick={() => launch("on")}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              background: busy ? "rgba(96,227,109,0.06)" : "rgba(96,227,109,0.18)",
              color: busy ? C.fg0 : C.green,
              border: `1px solid ${busy ? C.border : "rgba(96,227,109,0.35)"}`,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            Run with observer ON
          </button>
        </div>
      </div>
      <div className="flex-1 grid grid-cols-2 gap-4 p-6 overflow-auto sb">
        <ResultColumn label="Observer OFF" col={off} />
        <ResultColumn label="Observer ON" col={on} accent={C.green} />
      </div>
      <ComparisonBar off={off} on={on} />
    </div>
  );
}

function ResultColumn({ label, col, accent }: { label: string; col: ColumnState; accent?: string }) {
  const tone = accent ?? C.fg4;
  const seconds = col.durationMs == null ? null : (col.durationMs / 1000).toFixed(1);
  return (
    <div
      className="rounded-lg p-4 flex flex-col gap-3"
      style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}` }}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wide" style={{ color: C.fg0 }}>{label}</div>
          <div className="text-[14px] font-semibold" style={{ color: tone }}>{statusLabel(col.status)}</div>
        </div>
        <div className="text-right text-[10px] font-mono" style={{ color: C.fg0 }}>
          {col.runId ? (
            <Link to={runPath(col.runId)} className="underline-offset-2 hover:underline" style={{ color: C.fg2 }}>
              run {col.runId.slice(0, 12)}…
            </Link>
          ) : (
            "no run yet"
          )}
        </div>
      </div>
      <Stat label="wall-clock" value={seconds == null ? "—" : `${seconds}s`} />
      <Stat label="total tokens" value={fmt(col.totals.totalTokens)} />
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono" style={{ color: C.fg1 }}>
        <div>input: <span style={{ color: C.fg3 }}>{fmt(col.totals.inputTokens)}</span></div>
        <div>output: <span style={{ color: C.fg3 }}>{fmt(col.totals.outputTokens)}</span></div>
        <div>reasoning: <span style={{ color: C.fg3 }}>{fmt(col.totals.reasoningTokens)}</span></div>
        <div>steps: <span style={{ color: C.fg3 }}>{col.totals.steps}</span></div>
      </div>
      <Stat label="cost" value={`$${col.totals.costUsd.toFixed(4)}`} />
      {col.message && (
        <div className="text-[11px]" style={{ color: col.status === "error" ? C.red : C.fg1 }}>
          {col.message}
        </div>
      )}
    </div>
  );
}

function ComparisonBar({ off, on }: { off: ColumnState; on: ColumnState }) {
  const both = off.status === "done" && on.status === "done";
  const data = useMemo(() => {
    if (!both) return null;
    const tokenDelta = on.totals.totalTokens - off.totals.totalTokens;
    const costDelta = on.totals.costUsd - off.totals.costUsd;
    const wallDelta = (on.durationMs ?? 0) - (off.durationMs ?? 0);
    const pct = (delta: number, base: number) => (base === 0 ? 0 : (delta / base) * 100);
    return {
      tokenDelta,
      costDelta,
      wallDelta,
      tokenPct: pct(tokenDelta, off.totals.totalTokens),
      costPct: pct(costDelta, off.totals.costUsd),
      wallPct: pct(wallDelta, off.durationMs ?? 0),
    };
  }, [both, off, on]);
  if (!data) return null;
  const fmtDelta = (n: number, suffix = "") => `${n >= 0 ? "+" : ""}${n}${suffix}`;
  const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
  const colorFor = (n: number) => (n > 0 ? C.red : n < 0 ? C.green : C.fg2);
  return (
    <div
      className="px-6 py-3 grid grid-cols-3 gap-6 font-mono text-[11px]"
      style={{ borderTop: `1px solid ${C.border}`, background: "rgba(255,255,255,0.02)" }}
    >
      <div>
        <span style={{ color: C.fg0 }}>tokens (ON − OFF): </span>
        <span style={{ color: colorFor(data.tokenDelta) }}>
          {fmtDelta(data.tokenDelta)} ({fmtPct(data.tokenPct)})
        </span>
      </div>
      <div>
        <span style={{ color: C.fg0 }}>cost (ON − OFF): </span>
        <span style={{ color: colorFor(data.costDelta) }}>
          ${data.costDelta.toFixed(4)} ({fmtPct(data.costPct)})
        </span>
      </div>
      <div>
        <span style={{ color: C.fg0 }}>wall-clock (ON − OFF): </span>
        <span style={{ color: colorFor(data.wallDelta) }}>
          {fmtDelta(Math.round(data.wallDelta / 100) / 10, "s")} ({fmtPct(data.wallPct)})
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] uppercase tracking-wide" style={{ color: C.fg0 }}>{label}</span>
      <span className="text-[16px] font-semibold tabular-nums" style={{ color: C.fg4 }}>{value}</span>
    </div>
  );
}

function statusLabel(status: ColumnState["status"]): string {
  switch (status) {
    case "idle": return "Not run";
    case "starting": return "Starting…";
    case "running": return "Running…";
    case "done": return "Complete";
    case "error": return "Error";
  }
}

function fmt(n: number): string {
  return n.toLocaleString();
}
