import { Eraser, Undo2, X } from "lucide-react";
import { PointerEvent, useRef, useState } from "react";
import { Area } from "../../lib/api";

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const MIN_SIZE = 0.02; // anything smaller is an accidental click, not an area
export const MAX_AREAS = 16; // keep in sync with MAX_IGNORE_AREAS on the server

interface Props {
  imageUrl: string;
  value: Area[];
  onChange: (areas: Area[]) => void;
}

/**
 * Drag on the picture to draw a box over something that keeps causing false alarms (a ceiling-fan shadow, a window,
 * a TV). Boxes are stored normalised (0..1), so they survive a change of camera resolution.
 */
export function AreaEditor({ imageUrl, value, onChange }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<[number, number] | null>(null);
  const [draft, setDraft] = useState<Area | null>(null);
  const full = value.length >= MAX_AREAS;

  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)];
  };
  const rect = (a: [number, number], b: [number, number]): Area => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];

  const down = (e: PointerEvent) => {
    if (full || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = at(e);
  };
  const move = (e: PointerEvent) => {
    if (start.current) setDraft(rect(start.current, at(e)));
  };
  const up = (e: PointerEvent) => {
    if (!start.current) return;
    const a = rect(start.current, at(e));
    start.current = null;
    setDraft(null);
    if (a[2] - a[0] >= MIN_SIZE && a[3] - a[1] >= MIN_SIZE) onChange([...value, a]);
  };

  const style = (a: Area) => ({ left: `${a[0] * 100}%`, top: `${a[1] * 100}%`, width: `${(a[2] - a[0]) * 100}%`, height: `${(a[3] - a[1]) * 100}%` });

  return (
    <div>
      <div
        ref={box}
        className={`on-media relative select-none overflow-hidden rounded-lg border border-ink-600 bg-black touch-none ${full ? "" : "cursor-crosshair"}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => { start.current = null; setDraft(null); }}
      >
        <img src={imageUrl} alt="Camera preview" draggable={false} className="pointer-events-none block w-full" />
        {value.map((a, i) => (
          <div key={i} style={style(a)} className="absolute border-2 border-dashed border-slate-200 bg-slate-500/55">
            <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">Ignored {i + 1}</span>
            <button
              type="button"
              aria-label={`Remove ignored area ${i + 1}`}
              title="Remove"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              className="absolute -right-px -top-px flex h-6 w-6 items-center justify-center rounded-bl-md bg-black/70 text-white hover:bg-red-600"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        {draft && <div style={style(draft)} className="pointer-events-none absolute border-2 border-dashed border-ember-400 bg-ember-500/25" />}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
        <span>
          {full
            ? `Limit of ${MAX_AREAS} areas reached`
            : value.length
              ? `${value.length} ignored ${value.length === 1 ? "area" : "areas"} - drag to add another`
              : "Drag on the picture to draw a box over the false-alarm source"}
        </span>
        <span className="flex shrink-0 gap-1">
          <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => onChange(value.slice(0, -1))} disabled={!value.length}>
            <Undo2 size={13} /> Undo
          </button>
          <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => onChange([])} disabled={!value.length}>
            <Eraser size={13} /> Clear
          </button>
        </span>
      </div>
    </div>
  );
}
