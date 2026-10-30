import { motion } from "framer-motion";
import { FileWarning, Gauge, Loader2, Pencil, Rocket, Trash2, Zap } from "lucide-react";
import { LABEL_COLOR, ModelVersion, timeAgo } from "../../lib/api";
import { staggerItem } from "../Motion";
import { deltaVs, hasMetrics, METRICS, speedVs } from "./format";
import { MetricBar } from "./MetricBar";

export type ModelAction = "activate" | "benchmark" | "delete";

interface Props {
  model: ModelVersion;
  live: ModelVersion | null;
  busy: ModelAction | null; // action currently running on THIS card
  locked: boolean; // some other card is mid-action: disable everything
  onActivate: () => void;
  onBenchmark: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ModelCard({ model: m, live, busy, locked, onActivate, onBenchmark, onEdit, onDelete }: Props) {
  const speed = speedVs(m, live);
  const disabled = locked || busy !== null;
  const when = m.is_active
    ? `Live since ${timeAgo(m.activated_at ?? m.created_at)}`
    : m.deactivated_at
      ? `Last live ${timeAgo(m.deactivated_at)}`
      : `Added ${timeAgo(m.created_at)}`;

  return (
    <motion.article layout variants={staggerItem} exit={{ opacity: 0, scale: 0.95 }} className="card relative flex flex-col gap-4 p-5">
      {/* one ring that slides to whichever card becomes active */}
      {m.is_active && (
        <motion.div layoutId="live-ring" transition={{ type: "spring", stiffness: 380, damping: 34 }} className="pointer-events-none absolute -inset-px rounded-xl border-2 border-emerald-500/70" />
      )}

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-heading" title={m.name}>{m.name}</h3>
          <div className="mt-0.5 truncate font-mono text-xs text-slate-500" title={m.filename}>{m.filename}</div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {m.is_active && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative h-2 w-2 rounded-full bg-emerald-400" /></span>
              Live
            </span>
          )}
          {!m.file_exists && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-medium text-red-300"><FileWarning size={12} /> File missing</span>
          )}
          <span className="rounded-full bg-ink-700 px-2.5 py-0.5 text-xs font-medium capitalize text-slate-400">{m.location}</span>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-400">
        <span>{m.size_mb} MB</span>
        {m.params_m != null && <span>{m.params_m}M params</span>}
        {m.latency_ms != null && (
          <span className="inline-flex items-center gap-1" title="Median inference time on this server">
            <Gauge size={12} /> {Math.round(m.latency_ms)} ms
            {speed && <span className={speed.slower ? "text-amber-300" : "text-emerald-300"}>· {speed.text}</span>}
          </span>
        )}
        {m.classes?.map((c) => (
          <span key={c} className="rounded px-1.5 py-0.5 font-medium capitalize" style={{ color: LABEL_COLOR[c as "fire" | "smoke"] ?? "inherit", background: "rgb(var(--ink-800))" }}>{c}</span>
        ))}
      </div>

      {m.notes && <p className="text-sm text-slate-400">{m.notes}</p>}

      {hasMetrics(m) ? (
        <div className="grid grid-cols-2 gap-x-5 gap-y-3">
          {METRICS.map(({ key, label }) => <MetricBar key={key} label={label} value={m[key]} delta={deltaVs(m, live, key)} />)}
        </div>
      ) : (
        <button onClick={onEdit} className="rounded-lg border border-dashed border-ink-600 px-3 py-2.5 text-left text-xs text-slate-500 hover:border-ember-500 hover:text-slate-300">
          No accuracy numbers yet. Add them from your validation table to compare versions.
        </button>
      )}

      <footer className="mt-auto flex flex-wrap items-center gap-2 border-t border-ink-700 pt-4">
        <span className="mr-auto text-xs text-slate-500">{when}</span>
        {!m.is_active && (
          <button onClick={onActivate} disabled={disabled || !m.file_exists} className="btn-primary !px-3 !py-1.5">
            {busy === "activate" ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />}
            {busy === "activate" ? "Loading…" : "Activate"}
          </button>
        )}
        <button onClick={onBenchmark} disabled={disabled || !m.file_exists} className="btn-ghost !px-3 !py-1.5" title="Load the weights and re-measure speed on this server">
          {busy === "benchmark" ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />} Benchmark
        </button>
        <button onClick={onEdit} disabled={disabled} aria-label={`Edit ${m.name}`} className="rounded-lg p-2 text-slate-400 hover:bg-ink-700 hover:text-heading disabled:opacity-50"><Pencil size={16} /></button>
        <button
          onClick={onDelete}
          disabled={disabled || m.is_active}
          aria-label={`Delete ${m.name}`}
          title={m.is_active ? "The live model cannot be deleted" : "Delete this version"}
          className="rounded-lg p-2 text-slate-500 hover:bg-red-500/10 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-500"
        >
          {busy === "delete" ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
        </button>
      </footer>
    </motion.article>
  );
}
