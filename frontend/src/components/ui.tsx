import { ReactNode } from "react";
import { Label, LABEL_COLOR, labelTint, ReviewStatus } from "../lib/api";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-heading">{title}</h1>
        <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

export function StatCard({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: string; accent?: string }) {
  return (
    <div className="card p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-heading" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function LabelBadge({ label }: { label: Label }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase"
      style={{ background: labelTint(label), color: LABEL_COLOR[label] }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: LABEL_COLOR[label] }} />
      {label}
    </span>
  );
}

const REVIEW_STYLE: Record<ReviewStatus, { text: string; cls: string }> = {
  new: { text: "Needs review", cls: "bg-sky-500/15 text-sky-300" },
  real: { text: "Confirmed real", cls: "bg-emerald-500/15 text-emerald-300" },
  false_alarm: { text: "False alarm", cls: "bg-amber-500/15 text-amber-300" },
};

export function ReviewBadge({ status }: { status: ReviewStatus }) {
  const s = REVIEW_STYLE[status];
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.text}</span>;
}

export function ConfidenceSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3 text-sm text-slate-400">
      Confidence
      <input
        type="range"
        min={0.1}
        max={0.9}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-36 accent-orange-500"
      />
      <span className="w-10 tabular-nums text-slate-200">{Math.round(value * 100)}%</span>
    </label>
  );
}

export function Empty({ icon, text, action }: { icon: ReactNode; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-center text-sm text-slate-500">
      <div className="text-slate-600">{icon}</div>
      {text}
      {action}
    </div>
  );
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
        active ? "border-ember-500 bg-ember-500/15 text-ember-400" : "border-ink-600 bg-ink-800 text-slate-400 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}
