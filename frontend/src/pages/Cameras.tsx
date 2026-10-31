import { AnimatePresence, motion } from "framer-motion";
import { EyeOff, FileVideo, Pencil, Plus, Radio, ScanEye, Trash2, Video, Webcam } from "lucide-react";
import { useState } from "react";
import { CameraFormModal } from "../components/cameras/CameraFormModal";
import { ConfirmDialog } from "../components/Modal";
import { staggerContainer, staggerItem } from "../components/Motion";
import { Skeleton } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";
import { Switch } from "../components/Switch";
import { useToast } from "../components/Toast";
import { Empty, PageHeader } from "../components/ui";
import { useCameras } from "../hooks/useCameras";
import { useEvents } from "../hooks/useEvents";
import { api, Camera, SourceType } from "../lib/api";

const TYPE_META: Record<SourceType, { label: string; icon: typeof Radio }> = {
  stream: { label: "IP stream", icon: Radio },
  file: { label: "Video file", icon: FileVideo },
  device: { label: "Server webcam", icon: Webcam },
};

export default function Cameras() {
  const { cameras, error, reload } = useCameras();
  const { states } = useEvents();
  const toast = useToast();
  const [editing, setEditing] = useState<Camera | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Camera | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const openForm = (c: Camera | null) => { setEditing(c); setFormOpen(true); };

  const toggle = async (c: Camera, enabled: boolean) => {
    setBusy(c.id);
    try {
      await api.updateCamera(c.id, { enabled });
      await reload();
      toast({ tone: "info", title: enabled ? "Monitoring resumed" : "Camera paused", description: c.name });
    } catch (e) {
      toast({ tone: "error", title: "Could not update camera", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const c = deleting;
    setDeleting(null);
    try {
      await api.deleteCamera(c.id);
      await reload();
      toast({ tone: "success", title: "Camera removed", description: c.name });
    } catch (e) {
      toast({ tone: "error", title: "Could not delete camera", description: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <>
      <PageHeader
        title="Cameras"
        subtitle="Add, tune and pause the video sources SmokeShield watches."
        action={<button className="btn-primary" onClick={() => openForm(null)}><Plus size={16} /> Add camera</button>}
      />

      {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {cameras === null && !error && <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>}

      {cameras?.length === 0 && (
        <div className="card">
          <Empty
            icon={<Video size={40} />}
            text="You have not added any cameras."
            action={<button className="btn-primary mt-2" onClick={() => openForm(null)}><Plus size={16} /> Add camera</button>}
          />
        </div>
      )}

      <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="space-y-3">
        <AnimatePresence initial={false}>
          {cameras?.map((c) => {
            const Meta = TYPE_META[c.source_type];
            const status = states[c.id]?.status ?? (c.enabled ? "starting" : "disabled");
            return (
              <motion.li
                key={c.id}
                layout
                variants={staggerItem}
                exit={{ opacity: 0, x: -40, transition: { duration: 0.2 } }}
                className="card flex flex-wrap items-center gap-x-5 gap-y-3 p-4 sm:p-5"
              >
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-ink-800 text-slate-400">
                  <Meta.icon size={22} />
                </div>

                <div className="min-w-0 flex-1 basis-56">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate font-semibold text-heading">{c.name}</h2>
                    <StatusPill status={status} />
                  </div>
                  <div className="mt-0.5 truncate font-mono text-xs text-slate-500" title={c.source}>
                    {Meta.label} · {c.source_type === "file" ? "uploaded video" : c.source_type === "device" ? `camera ${c.source}` : c.source}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                    <Tag>Confidence {Math.round(c.confidence * 100)}%</Tag>
                    <Tag>{c.confirm_frames}/{c.confirm_window} frames</Tag>
                    <Tag>Cooldown {c.cooldown >= 60 ? `${Math.round(c.cooldown / 60)}m` : `${c.cooldown}s`}</Tag>
                    {c.zone && <Tag highlight><ScanEye size={12} /> Zone</Tag>}
                    {!c.detect_smoke && <Tag highlight>Fire only</Tag>}
                    {c.detect_smoke && c.smoke_confidence && <Tag>Smoke {Math.round(c.smoke_confidence * 100)}%+</Tag>}
                    {!!c.ignore_areas?.length && <Tag highlight><EyeOff size={12} /> {c.ignore_areas.length} ignored</Tag>}
                  </div>
                </div>

                <div className="ml-auto flex items-center gap-3">
                  <Switch checked={c.enabled} disabled={busy === c.id} onChange={(v) => toggle(c, v)} label={`${c.enabled ? "Pause" : "Resume"} ${c.name}`} />
                  <button onClick={() => openForm(c)} aria-label={`Edit ${c.name}`} className="rounded-lg p-2 text-slate-400 hover:bg-ink-700 hover:text-heading"><Pencil size={17} /></button>
                  <button onClick={() => setDeleting(c)} aria-label={`Delete ${c.name}`} className="rounded-lg p-2 text-slate-500 hover:bg-red-500/10 hover:text-red-400"><Trash2 size={17} /></button>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </motion.ul>

      <CameraFormModal open={formOpen} camera={editing} onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); reload(); }} />
      <ConfirmDialog
        open={!!deleting}
        title="Delete camera?"
        message={`"${deleting?.name}" will stop monitoring. Its past incidents are kept.`}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function Tag({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 ${highlight ? "bg-ember-500/15 text-ember-400" : "bg-ink-800 text-slate-400"}`}>
      {children}
    </span>
  );
}
