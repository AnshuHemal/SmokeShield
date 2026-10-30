import { ReactNode } from "react";
import { COLORS, Label } from "../lib/api";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-white">{title}</h1>
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
      <div className="mt-2 text-3xl font-semibold text-white" style={accent ? { color: accent } : undefined}>
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
      style={{ background: COLORS[label] + "26", color: COLORS[label] }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: COLORS[label] }} />
      {label}
    </span>
  );
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

export function Empty({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-sm text-slate-500">
      <div className="text-slate-600">{icon}</div>
      {text}
    </div>
  );
}
