import { Check, X } from "lucide-react";
import { ReviewStatus } from "../lib/api";

interface Props {
  status: ReviewStatus;
  onChange: (s: ReviewStatus) => void;
  size?: "sm" | "md";
}

/** Two toggle buttons; clicking the active one clears the review. */
export function ReviewButtons({ status, onChange, size = "sm" }: Props) {
  const pad = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  const base = `inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border font-medium transition ${pad}`;
  const toggle = (target: Exclude<ReviewStatus, "new">) => onChange(status === target ? "new" : target);
  return (
    <div className="flex gap-2" role="group" aria-label="Review this incident">
      <button
        onClick={() => toggle("real")}
        aria-pressed={status === "real"}
        className={`${base} ${status === "real" ? "border-emerald-500 bg-emerald-500/20 text-emerald-300" : "border-ink-600 bg-ink-800 text-slate-400 hover:border-emerald-500/50 hover:text-emerald-300"}`}
      >
        <Check size={14} /> Real
      </button>
      <button
        onClick={() => toggle("false_alarm")}
        aria-pressed={status === "false_alarm"}
        className={`${base} ${status === "false_alarm" ? "border-amber-500 bg-amber-500/20 text-amber-300" : "border-ink-600 bg-ink-800 text-slate-400 hover:border-amber-500/50 hover:text-amber-300"}`}
      >
        <X size={14} /> False alarm
      </button>
    </div>
  );
}
