import { History, Settings2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useFramePoll } from "../../hooks/useFramePoll";
import { Camera, CameraState, LABEL_COLOR } from "../../lib/api";
import { Modal } from "../Modal";
import { StatusPill } from "../StatusPill";
import { isLive } from "./CameraTile";

interface Props {
  camera: Camera | null;
  state?: CameraState;
  onClose: () => void;
  onEdit: (c: Camera) => void;
}

export function FeedView({ camera, state, onClose, onEdit }: Props) {
  return (
    <Modal open={!!camera} onClose={onClose} title={camera?.name} width="max-w-5xl">
      {camera && <Body camera={camera} state={state} onEdit={onEdit} onClose={onClose} />}
    </Modal>
  );
}

function Body({ camera, state, onEdit, onClose }: { camera: Camera; state?: CameraState; onEdit: (c: Camera) => void; onClose: () => void }) {
  const navigate = useNavigate();
  const status = state?.status ?? "starting";
  const frame = useFramePoll(camera.id, isLive(status), 300);

  return (
    <div className="grid gap-6 p-6 lg:grid-cols-[1fr_260px]">
      <div className="relative aspect-video overflow-hidden rounded-lg bg-black on-media">
        {frame ? (
          <img src={frame} alt={`${camera.name} live view`} className="h-full w-full object-contain" />
        ) : (
          <div className="grid h-full place-items-center text-sm text-slate-500">{status === "offline" ? "No signal" : "Waiting for video…"}</div>
        )}
      </div>

      <div className="space-y-5 text-sm">
        <StatusPill status={status} />
        <dl className="space-y-2">
          <Row k="Throughput" v={state && isLive(status) ? `${state.fps} fps` : "–"} />
          <Row k="Inference" v={state && isLive(status) ? `${state.latency_ms} ms` : "–"} />
          <Row k="Confidence" v={`${Math.round(camera.confidence * 100)}%`} />
          <Row k="Confirmation" v={`${camera.confirm_frames} of ${camera.confirm_window} frames`} />
          <Row k="Detail" v={camera.imgsz ? `${camera.imgsz} px` : "Standard (640 px)"} />
          <Row k="Merge window" v={`${camera.cooldown}s`} />
          <Row k="Zone" v={camera.zone ? `${camera.zone.length} points` : "Full frame"} />
        </dl>

        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Confirmed now</div>
          {state?.detections.length ? (
            state.detections.map((d, i) => (
              <div key={i} className="flex justify-between">
                <span className="capitalize" style={{ color: LABEL_COLOR[d.label] }}>{d.label}{d.held ? " (last seen)" : ""}</span>
                <span className="tabular-nums">{Math.round(d.confidence * 100)}%</span>
              </div>
            ))
          ) : (
            <div className="text-slate-500">All clear</div>
          )}
        </div>

        {!!state?.pending?.length && (
          <div>
            <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Verifying</div>
            {state.pending.map((d, i) => (
              <div key={i} className="flex justify-between text-amber-300">
                <span className="capitalize">Possible {d.label}</span>
                <span className="tabular-nums">{Math.round(d.confidence * 100)}%</span>
              </div>
            ))}
          </div>
        )}

        {status === "offline" && state?.error && <p className="rounded-lg bg-ink-800 p-3 text-xs text-slate-400">{state.error}</p>}

        <div className="flex flex-col gap-2 pt-1">
          <button className="btn-ghost" onClick={() => { onClose(); navigate(`/incidents?camera=${camera.id}`); }}>
            <History size={16} /> View incidents
          </button>
          <button className="btn-ghost" onClick={() => onEdit(camera)}>
            <Settings2 size={16} /> Edit settings
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{k}</dt>
      <dd className="tabular-nums text-slate-200">{v}</dd>
    </div>
  );
}
