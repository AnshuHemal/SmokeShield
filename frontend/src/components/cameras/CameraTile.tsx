import { motion } from "framer-motion";
import { Gauge, Maximize2, Pause, VideoOff } from "lucide-react";
import { useFramePoll } from "../../hooks/useFramePoll";
import { Camera, CameraState, CameraStatus } from "../../lib/api";
import { staggerItem } from "../Motion";
import { StatusPill } from "../StatusPill";

export const isLive = (s: CameraStatus) => s === "ok" || s === "smoke" || s === "fire";

export function CameraTile({ camera, state, onOpen }: { camera: Camera; state?: CameraState; onOpen: () => void }) {
  const status: CameraStatus = state?.status ?? (camera.enabled ? "starting" : "disabled");
  const frame = useFramePoll(camera.id, isLive(status));

  const ring =
    status === "fire" ? "animate-alarm border-red-500" : status === "smoke" ? "border-amber-500/70" : "border-ink-700";

  return (
    <motion.button
      layout
      variants={staggerItem}
      whileHover={{ y: -3 }}
      onClick={onOpen}
      aria-label={`Open ${camera.name}`}
      className={`group relative block w-full overflow-hidden rounded-xl border bg-ink-900 text-left transition-colors ${ring}`}
    >
      <div className="relative aspect-video bg-black on-media">
        {frame ? (
          <img src={frame} alt={`${camera.name} live view`} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <Placeholder status={status} error={state?.error} />
        )}

        {status === "fire" && <div className="pointer-events-none absolute inset-0 animate-pulse bg-red-600/10" />}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/80 to-transparent" />

        <div className="absolute left-3 top-3"><StatusPill status={status} /></div>
        <div className="absolute right-3 top-3 rounded-md bg-black/50 p-1.5 text-slate-300 opacity-0 backdrop-blur transition group-hover:opacity-100">
          <Maximize2 size={14} />
        </div>

        <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-heading">{camera.name}</div>
            {state && isLive(status) && (
              <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-300">
                <Gauge size={12} /> {state.fps} fps · {state.latency_ms} ms
              </div>
            )}
          </div>
          {state?.detections.length ? (
            <div className="flex gap-1">
              {state.detections.slice(0, 3).map((d, i) => (
                <span key={i} className={`rounded px-1.5 py-0.5 text-xs font-bold uppercase ${d.label === "fire" ? "bg-red-600 text-white" : "bg-white/90 text-slate-900"}`}>
                  {d.label} {Math.round(d.confidence * 100)}%
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </motion.button>
  );
}

function Placeholder({ status, error }: { status: CameraStatus; error?: string | null }) {
  const Icon = status === "disabled" ? Pause : VideoOff;
  return (
    <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-ink-900 to-ink-800 p-4 text-center">
      <div className="flex flex-col items-center gap-2 text-slate-500">
        {status === "starting" ? (
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-400/30 border-t-sky-400" />
        ) : (
          <Icon size={30} />
        )}
        <div className="text-sm">
          {status === "starting" && "Connecting…"}
          {status === "disabled" && "Camera paused"}
          {status === "offline" && "No signal - retrying automatically"}
        </div>
        {status === "offline" && error && <div className="max-w-[16rem] truncate text-xs text-slate-600" title={error}>{error}</div>}
      </div>
    </div>
  );
}
