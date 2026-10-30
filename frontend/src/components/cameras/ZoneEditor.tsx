import { Eraser, Undo2 } from "lucide-react";
import { PointerEvent, useRef } from "react";
import { Point } from "../../lib/api";

const clamp = (n: number) => Math.min(1, Math.max(0, n));

interface Props {
  imageUrl: string;
  value: Point[];
  onChange: (points: Point[]) => void;
}

/**
 * Click the image to add polygon corners, drag a corner to move it, double-click a corner to delete it.
 * Points are stored normalised (0..1), so the zone is resolution-independent.
 */
export function ZoneEditor({ imageUrl, value, onChange }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);

  const toPoint = (e: { clientX: number; clientY: number }): Point => {
    const r = box.current!.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)];
  };

  const move = (i: number, e: PointerEvent) => {
    if (dragging.current !== i) return;
    onChange(value.map((p, idx) => (idx === i ? toPoint(e) : p)));
  };

  const path = value.map(([x, y]) => `${x} ${y}`).join(" L ");

  return (
    <div>
      <div
        ref={box}
        className="relative cursor-crosshair select-none overflow-hidden rounded-lg border border-ink-600 bg-black"
        onClick={(e) => onChange([...value, toPoint(e)])}
      >
        <img src={imageUrl} alt="Camera preview" draggable={false} className="block w-full" />
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
          {value.length >= 3 && (
            <>
              <path fillRule="evenodd" d={`M0 0H1V1H0Z M ${path} Z`} fill="rgba(0,0,0,0.55)" />
              <path d={`M ${path} Z`} fill="rgba(255,106,43,0.12)" stroke="#ff6a2b" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            </>
          )}
          {value.length === 2 && <path d={`M ${path}`} stroke="#ff6a2b" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
        </svg>
        {value.map(([x, y], i) => (
          <button
            key={i}
            type="button"
            aria-label={`Zone point ${i + 1}`}
            title="Drag to move · double-click to remove"
            style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
            className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-white bg-ember-500 shadow-lg active:cursor-grabbing"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => { e.stopPropagation(); onChange(value.filter((_, idx) => idx !== i)); }}
            onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); dragging.current = i; }}
            onPointerMove={(e) => move(i, e)}
            onPointerUp={() => { dragging.current = null; }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>
          {value.length < 3
            ? `Click the image to add corners (${value.length}/3 minimum)`
            : `${value.length} points - detections outside the lit area are ignored`}
        </span>
        <span className="flex gap-1">
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
