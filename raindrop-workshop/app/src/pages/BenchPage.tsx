import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { postBenchRun, type BenchObserverMode, type BenchProgressEvent, type BenchTotals } from "../api/bench";
import { useWorkshopEvent } from "../hooks/use-workshop-ws";
import { runPath } from "../utils/navigation";
import { C } from "../utils/colors";

interface RunState {
  benchId: string;
  observer: BenchObserverMode;
  status: "starting" | "running" | "done" | "error";
  runId: string | null;
  totals: BenchTotals;
  durationMs: number | null;
  exitCode: number | null;
  message: string | null;
}

interface ColumnState {
  observer: BenchObserverMode;
  runs: RunState[];
}

const EMPTY_TOTALS: BenchTotals = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  costUsd: 0,
  steps: 0,
};

function blankRun(benchId: string, observer: BenchObserverMode): RunState {
  return {
    benchId,
    observer,
    status: "starting",
    runId: null,
    totals: { ...EMPTY_TOTALS },
    durationMs: null,
    exitCode: null,
    message: null,
  };
}

function blankColumn(observer: BenchObserverMode): ColumnState {
  return { observer, runs: [] };
}

const DEFAULT_PROMPT_FALLBACK = `Read the local file research_brief.md, then summarize the three most important facts you can verify from facts.md. If a claim in obsolete_notes.md contradicts facts.md, prefer facts.md and explain why.`;
const DEFAULT_PROMPT = (typeof __BENCH_DEFAULT_PROMPT__ === "string" && __BENCH_DEFAULT_PROMPT__.trim())
  ? __BENCH_DEFAULT_PROMPT__
  : DEFAULT_PROMPT_FALLBACK;

export function BenchPage() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [model, setModel] = useState("anthropic/claude-sonnet-4-6");
  const [cwd, setCwd] = useState("scenarios/jinja-cve-2025-27516/fixture-repo");
  const [runCount, setRunCount] = useState(1);
  const [off, setOff] = useState<ColumnState>(() => blankColumn("off"));
  const [on, setOn] = useState<ColumnState>(() => blankColumn("on"));

  // Pre-POST events arrive before the column knows its benchIds. Buffer them
  // by benchId and apply once a column registers that id.
  const pending = useRef<Map<string, BenchProgressEvent[]>>(new Map());

  const applyEventToRun = (prev: RunState, event: BenchProgressEvent): RunState => {
    const next: RunState = { ...prev };
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
      const idx = prev.runs.findIndex((r) => r.benchId === event.benchId);
      if (idx < 0) {
        const list = pending.current.get(event.benchId) ?? [];
        list.push(event);
        pending.current.set(event.benchId, list);
        return prev;
      }
      const nextRuns = prev.runs.slice();
      nextRuns[idx] = applyEventToRun(nextRuns[idx], event);
      return { ...prev, runs: nextRuns };
    });
  }, []);

  useWorkshopEvent("bench_event", updateForBench);

  const launch = useCallback(async (observer: BenchObserverMode) => {
    const setter = observer === "off" ? setOff : setOn;
    setter(blankColumn(observer));
    try {
      const res = await postBenchRun({ prompt, observer, cwd, model, runs: runCount });
      setter(() => {
        const newRuns = res.benchIds.map((id) => {
          const buffered = pending.current.get(id) ?? [];
          pending.current.delete(id);
          let r = blankRun(id, observer);
          for (const event of buffered) r = applyEventToRun(r, event);
          return r;
        });
        return { observer, runs: newRuns };
      });
    } catch (err) {
      setter({
        observer,
        runs: [{
          benchId: "error",
          observer,
          status: "error",
          runId: null,
          totals: { ...EMPTY_TOTALS },
          durationMs: null,
          exitCode: null,
          message: err instanceof Error ? err.message : String(err),
        }],
      });
    }
  }, [prompt, cwd, model, runCount]);

  const offBusy = isBusy(off);
  const onBusy = isBusy(on);

  return (
    <div className="flex h-full flex-col" style={{ background: C.bg }}>
      <div className="flex flex-col gap-3 px-6 py-4" style={{ borderBottom: `1px solid ${C.border}` }}>
        <div>
          <div className="text-[10px] uppercase tracking-wide font-medium" style={{ color: C.fg0 }}>Observer benchmark</div>
          <div className="text-[18px] font-semibold" style={{ color: C.fg4 }}>Compare worker runs with the observer ON vs OFF.</div>
          <div className="text-[12px] mt-1" style={{ color: C.fg1 }}>
            Each click spawns N parallel OpenCode workers. OFF runs are tagged so the local observer ignores them; ON runs feed the observer normally.
            Mean and standard deviation across N appear once runs complete.
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
              style={{ background: "rgba(255,255,255,0.04)", color: C.fg4, border: `1px solid ${C.border}`, width: 320 }}
            />
          </label>
          <label className="text-[11px]" style={{ color: C.fg1 }}>
            model
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="ml-2 rounded px-2 py-1 text-[11px] font-mono"
              style={{ background: "rgba(255,255,255,0.04)", color: C.fg4, border: `1px solid ${C.border}`, width: 200 }}
            />
          </label>
          <label className="text-[11px]" style={{ color: C.fg1 }}>
            runs
            <input
              type="number"
              min={1}
              max={20}
              value={runCount}
              onChange={(e) => setRunCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              className="ml-2 rounded px-2 py-1 text-[11px] font-mono"
              style={{ background: "rgba(255,255,255,0.04)", color: C.fg4, border: `1px solid ${C.border}`, width: 60 }}
            />
          </label>
          <div className="flex-1" />
          <button
            onClick={() => launch("off")}
            disabled={offBusy}
            className="rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              background: offBusy ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.10)",
              color: offBusy ? C.fg0 : C.fg4,
              border: `1px solid ${C.border}`,
              cursor: offBusy ? "not-allowed" : "pointer",
            }}
          >
            Run {runCount}× with observer OFF
          </button>
          <button
            onClick={() => launch("on")}
            disabled={onBusy}
            className="rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              background: onBusy ? "rgba(96,227,109,0.06)" : "rgba(96,227,109,0.18)",
              color: onBusy ? C.fg0 : C.green,
              border: `1px solid ${onBusy ? C.border : "rgba(96,227,109,0.35)"}`,
              cursor: onBusy ? "not-allowed" : "pointer",
            }}
          >
            Run {runCount}× with observer ON
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

interface AggregateStats {
  count: number;
  totalTokensMean: number;
  totalTokensStd: number;
  costMean: number;
  costStd: number;
  durationMean: number;
  durationStd: number;
  inputMean: number;
  outputMean: number;
  reasoningMean: number;
  stepsMean: number;
}

function aggregate(runs: RunState[]): AggregateStats | null {
  const done = runs.filter((r) => r.status === "done");
  if (done.length === 0) return null;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const std = (xs: number[]) => {
    if (xs.length < 2) return 0;
    const m = mean(xs);
    return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
  };
  const totals = done.map((r) => r.totals.totalTokens);
  const inputs = done.map((r) => r.totals.inputTokens);
  const outputs = done.map((r) => r.totals.outputTokens);
  const reasoning = done.map((r) => r.totals.reasoningTokens);
  const costs = done.map((r) => r.totals.costUsd);
  const steps = done.map((r) => r.totals.steps);
  const durations = done.map((r) => r.durationMs ?? 0);
  return {
    count: done.length,
    totalTokensMean: mean(totals),
    totalTokensStd: std(totals),
    costMean: mean(costs),
    costStd: std(costs),
    durationMean: mean(durations),
    durationStd: std(durations),
    inputMean: mean(inputs),
    outputMean: mean(outputs),
    reasoningMean: mean(reasoning),
    stepsMean: mean(steps),
  };
}

function isBusy(col: ColumnState): boolean {
  return col.runs.some((r) => r.status === "starting" || r.status === "running");
}

function ResultColumn({ label, col, accent }: { label: string; col: ColumnState; accent?: string }) {
  const tone = accent ?? C.fg4;
  const stats = useMemo(() => aggregate(col.runs), [col.runs]);
  const total = col.runs.length;
  const done = col.runs.filter((r) => r.status === "done").length;
  const errored = col.runs.filter((r) => r.status === "error").length;
  const status = total === 0
    ? "Not run"
    : done === total
      ? "Complete"
      : errored > 0 && done + errored === total
        ? "Errors"
        : `Running (${done}/${total})`;
  const [showRuns, setShowRuns] = useState(false);

  return (
    <div
      className="rounded-lg p-4 flex flex-col gap-3"
      style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}` }}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wide" style={{ color: C.fg0 }}>{label}</div>
          <div className="text-[14px] font-semibold" style={{ color: tone }}>{status}</div>
        </div>
        <div className="text-right text-[10px] font-mono" style={{ color: C.fg0 }}>
          {total > 0 && (
            <div>{done} done · {errored} errored · {total - done - errored} running</div>
          )}
        </div>
      </div>
      {stats ? (
        <>
          <Stat label="wall-clock (mean)" value={meanStdSeconds(stats.durationMean, stats.durationStd)} />
          <Stat label="total tokens (mean)" value={meanStd(stats.totalTokensMean, stats.totalTokensStd)} />
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono" style={{ color: C.fg1 }}>
            <div>input: <span style={{ color: C.fg3 }}>{fmt(Math.round(stats.inputMean))}</span></div>
            <div>output: <span style={{ color: C.fg3 }}>{fmt(Math.round(stats.outputMean))}</span></div>
            <div>reasoning: <span style={{ color: C.fg3 }}>{fmt(Math.round(stats.reasoningMean))}</span></div>
            <div>steps: <span style={{ color: C.fg3 }}>{stats.stepsMean.toFixed(1)}</span></div>
          </div>
          <Stat label="cost (mean)" value={`$${stats.costMean.toFixed(4)} ± $${stats.costStd.toFixed(4)}`} />
          <div className="text-[10px] font-mono" style={{ color: C.fg0 }}>
            n = {stats.count}{total > stats.count ? ` of ${total}` : ""}
          </div>
        </>
      ) : (
        <div className="text-[11px]" style={{ color: C.fg1 }}>
          {total === 0 ? "No runs yet." : "Awaiting first completion…"}
        </div>
      )}
      {total > 0 && (
        <div>
          <button
            onClick={() => setShowRuns((v) => !v)}
            className="text-[10px] flex items-center gap-1"
            style={{ color: C.fg1 }}
          >
            {showRuns ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {showRuns ? "hide" : "show"} {total} run{total === 1 ? "" : "s"}
          </button>
          {showRuns && (
            <div className="mt-2 space-y-1">
              {col.runs.map((r, i) => <RunRow key={r.benchId} index={i} run={r} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RunRow({ index, run }: { index: number; run: RunState }) {
  const seconds = run.durationMs == null ? "—" : `${(run.durationMs / 1000).toFixed(1)}s`;
  const tone = run.status === "done" ? C.fg3 : run.status === "error" ? C.red : C.fg1;
  return (
    <div className="flex items-center gap-3 text-[10px] font-mono" style={{ color: tone }}>
      <span style={{ color: C.fg0 }}>#{index + 1}</span>
      <span style={{ width: 80 }}>{statusGlyph(run.status)} {run.status}</span>
      <span style={{ width: 80 }}>{seconds}</span>
      <span style={{ width: 110 }}>{fmt(run.totals.totalTokens)} tok</span>
      <span style={{ width: 90 }}>${run.totals.costUsd.toFixed(4)}</span>
      {run.runId ? (
        <Link to={runPath(run.runId)} className="underline-offset-2 hover:underline" style={{ color: C.fg2 }}>
          {run.runId.slice(0, 12)}…
        </Link>
      ) : (
        <span style={{ color: C.fg0 }}>—</span>
      )}
      {run.message && <span style={{ color: C.fg0 }}>{run.message}</span>}
    </div>
  );
}

function ComparisonBar({ off, on }: { off: ColumnState; on: ColumnState }) {
  const offStats = useMemo(() => aggregate(off.runs), [off.runs]);
  const onStats = useMemo(() => aggregate(on.runs), [on.runs]);
  if (!offStats || !onStats) return null;
  const tokenDelta = onStats.totalTokensMean - offStats.totalTokensMean;
  const costDelta = onStats.costMean - offStats.costMean;
  const wallDelta = onStats.durationMean - offStats.durationMean;
  const pct = (delta: number, base: number) => (base === 0 ? 0 : (delta / base) * 100);
  const fmtDelta = (n: number, suffix = "") => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()}${suffix}`;
  const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
  const colorFor = (n: number) => (n > 0 ? C.red : n < 0 ? C.green : C.fg2);
  return (
    <div
      className="px-6 py-3 grid grid-cols-3 gap-6 font-mono text-[11px]"
      style={{ borderTop: `1px solid ${C.border}`, background: "rgba(255,255,255,0.02)" }}
    >
      <div>
        <span style={{ color: C.fg0 }}>tokens (ON − OFF, mean): </span>
        <span style={{ color: colorFor(tokenDelta) }}>
          {fmtDelta(tokenDelta)} ({fmtPct(pct(tokenDelta, offStats.totalTokensMean))})
        </span>
      </div>
      <div>
        <span style={{ color: C.fg0 }}>cost (ON − OFF, mean): </span>
        <span style={{ color: colorFor(costDelta) }}>
          ${costDelta.toFixed(4)} ({fmtPct(pct(costDelta, offStats.costMean))})
        </span>
      </div>
      <div>
        <span style={{ color: C.fg0 }}>wall-clock (ON − OFF, mean): </span>
        <span style={{ color: colorFor(wallDelta) }}>
          {(wallDelta / 1000).toFixed(1)}s ({fmtPct(pct(wallDelta, offStats.durationMean))})
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

function meanStd(mean: number, std: number): string {
  return `${fmt(Math.round(mean))} ± ${fmt(Math.round(std))}`;
}

function meanStdSeconds(meanMs: number, stdMs: number): string {
  return `${(meanMs / 1000).toFixed(1)}s ± ${(stdMs / 1000).toFixed(1)}s`;
}

function statusGlyph(status: RunState["status"]): string {
  switch (status) {
    case "starting": return "○";
    case "running": return "◐";
    case "done": return "●";
    case "error": return "✕";
  }
}

function fmt(n: number): string {
  return n.toLocaleString();
}
