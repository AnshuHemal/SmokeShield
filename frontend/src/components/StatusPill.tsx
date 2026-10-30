import { CameraStatus } from "../lib/api";

const CONFIG: Record<CameraStatus, { label: string; dot: string; chip: string; pulse?: boolean }> = {
  ok: { label: "Monitoring", dot: "bg-emerald-400", chip: "bg-emerald-500/15 text-emerald-300", pulse: true },
  smoke: { label: "Smoke detected", dot: "bg-amber-400", chip: "bg-amber-500/20 text-amber-300", pulse: true },
  fire: { label: "Fire detected", dot: "bg-red-500", chip: "bg-red-500/25 text-red-300", pulse: true },
  offline: { label: "Offline", dot: "bg-slate-500", chip: "bg-slate-500/20 text-slate-400" },
  starting: { label: "Connecting", dot: "bg-sky-400", chip: "bg-sky-500/15 text-sky-300", pulse: true },
  disabled: { label: "Paused", dot: "bg-slate-600", chip: "bg-ink-700 text-slate-400" },
};

export function StatusPill({ status, compact = false }: { status: CameraStatus; compact?: boolean }) {
  const c = CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold backdrop-blur ${c.chip}`}>
      <span className="relative flex h-2 w-2">
        {c.pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${c.dot}`} />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${c.dot}`} />
      </span>
      {!compact && c.label}
    </span>
  );
}
