import { motion } from "framer-motion";
import { pct } from "./format";

interface Props {
  label: string;
  value: number | null;
  /** Percentage-point difference versus the live model (fraction, e.g. 0.122 = +12.2). */
  delta?: number | null;
}

export function MetricBar({ label, value, delta }: Props) {
  const showDelta = delta != null && Math.abs(delta) >= 0.0005;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-slate-500">{label}</span>
        <span className="flex items-baseline gap-1.5 tabular-nums">
          {showDelta && (
            <span className={`font-medium ${delta! > 0 ? "text-emerald-300" : "text-red-300"}`} title="Difference versus the live model, in percentage points">
              {delta! > 0 ? "+" : "−"}{Math.abs(delta! * 100).toFixed(1)}
            </span>
          )}
          <span className="font-semibold text-heading">{pct(value)}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-700" role="img" aria-label={`${label}: ${pct(value)}`}>
        {value != null && (
          <motion.div
            className="h-full rounded-full bg-ember-500"
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(100, value * 100)}%` }}
            transition={{ duration: 0.7, ease: "easeOut" }}
          />
        )}
      </div>
    </div>
  );
}
