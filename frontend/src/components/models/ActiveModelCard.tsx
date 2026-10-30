import { motion } from "framer-motion";
import { Cpu, Gauge, Loader2, Undo2, Upload } from "lucide-react";
import { LABEL_COLOR, ModelVersion, timeAgo } from "../../lib/api";
import { AnimatedNumber } from "../AnimatedNumber";
import { hasMetrics, METRICS } from "./format";

interface Props {
  model: ModelVersion | null;
  previous: ModelVersion | null;
  rollingBack: boolean;
  disabled: boolean;
  camerasOnline: number;
  onRollback: () => void;
  onUpload: () => void;
}

/** The model serving detections right now, with the numbers that matter. */
export function ActiveModelCard({ model: m, previous, rollingBack, disabled, camerasOnline, onRollback, onUpload }: Props) {
  if (!m) {
    return (
      <div className="card flex flex-col items-center gap-3 border-dashed p-10 text-center">
        <Cpu size={36} className="text-slate-600" />
        <div className="font-semibold text-heading">No model is live</div>
        <p className="max-w-md text-sm text-slate-500">Detection is paused. Activate a version below, or upload weights trained with <code className="font-mono">backend/train.py</code> or Colab.</p>
        <button onClick={onUpload} className="btn-primary mt-1"><Upload size={16} /> Upload a model</button>
      </div>
    );
  }

  return (
    <motion.section
      key={m.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="card relative overflow-hidden p-6"
      aria-label="Live model"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500/0 via-emerald-500/70 to-emerald-500/0" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-300">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative h-2 w-2 rounded-full bg-emerald-400" /></span>
            Live model
          </div>
          <h2 className="mt-1.5 truncate text-2xl font-semibold text-heading">{m.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-400">
            <span className="font-mono text-xs text-slate-500">{m.filename}</span>
            <span>{m.size_mb} MB</span>
            {m.params_m != null && <span>{m.params_m}M parameters</span>}
            {m.latency_ms != null && <span className="inline-flex items-center gap-1"><Gauge size={14} /> {Math.round(m.latency_ms)} ms / frame</span>}
            <span>since {timeAgo(m.activated_at ?? m.created_at)}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {m.classes?.map((c) => (
              <span key={c} className="rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize" style={{ color: LABEL_COLOR[c as "fire" | "smoke"] ?? "inherit", background: "rgb(var(--ink-800))" }}>{c}</span>
            ))}
            <span className="text-xs text-slate-500">· serving {camerasOnline} online {camerasOnline === 1 ? "camera" : "cameras"}</span>
          </div>
        </div>

        <button onClick={onRollback} disabled={!previous || disabled} className="btn-ghost" title={previous ? `Switch back to ${previous.name}` : "No earlier version to return to"}>
          {rollingBack ? <Loader2 size={16} className="animate-spin" /> : <Undo2 size={16} />}
          Roll back{previous ? ` to ${previous.name.length > 22 ? previous.name.slice(0, 21) + "…" : previous.name}` : ""}
        </button>
      </div>

      {m.notes && <p className="mt-4 text-sm text-slate-400">{m.notes}</p>}

      <dl className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {METRICS.map(({ key, label }) => (
          <div key={key} className="rounded-xl bg-ink-800 p-3.5 sm:p-4">
            <dt className="whitespace-nowrap text-xs font-medium text-slate-500">{label}</dt>
            <dd className="mt-1.5 text-2xl font-semibold tabular-nums text-heading sm:text-3xl">
              {m[key] == null ? <span className="text-slate-600">—</span> : <AnimatedNumber value={(m[key] as number) * 100} format={(n) => `${n.toFixed(1)}%`} />}
            </dd>
          </div>
        ))}
      </dl>
      {!hasMetrics(m) && <p className="mt-3 text-xs text-slate-500">Accuracy numbers are entered by hand: use Edit on the version below to add them from your validation results.</p>}
    </motion.section>
  );
}
