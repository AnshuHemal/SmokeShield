import { AnimatePresence, motion } from "framer-motion";
import { Flame, LayoutGrid, Plus, Settings2, Video } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CameraFormModal } from "../components/cameras/CameraFormModal";
import { CameraTile } from "../components/cameras/CameraTile";
import { FeedView } from "../components/cameras/FeedView";
import { staggerContainer } from "../components/Motion";
import { Skeleton } from "../components/Skeleton";
import { Empty, PageHeader } from "../components/ui";
import { useCameras } from "../hooks/useCameras";
import { useEvents } from "../hooks/useEvents";
import { Camera } from "../lib/api";

const COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 md:grid-cols-2",
  3: "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
  4: "grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4",
};

export default function Monitor() {
  const { cameras, error, reload } = useCameras();
  const { states, connected } = useEvents();
  const [density, setDensity] = useState(3);
  const [selected, setSelected] = useState<Camera | null>(null);
  const [editing, setEditing] = useState<Camera | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const summary = useMemo(() => {
    const list = Object.values(states);
    const alarms = (cameras ?? []).filter((c) => ["fire", "smoke"].includes(states[c.id]?.status ?? ""));
    return {
      online: list.filter((s) => ["ok", "smoke", "fire"].includes(s.status)).length,
      offline: list.filter((s) => s.status === "offline").length,
      alarms,
    };
  }, [states, cameras]);

  const openForm = (c: Camera | null) => { setSelected(null); setEditing(c); setFormOpen(true); };

  return (
    <>
      <PageHeader
        title="Monitor"
        subtitle="Live view of every camera with real-time detection."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-ink-600" role="group" aria-label="Grid density">
              {[2, 3, 4].map((n) => (
                <button key={n} onClick={() => setDensity(n)} aria-pressed={density === n} aria-label={`${n} columns`}
                  className={`px-3 py-2 text-sm ${density === n ? "bg-ink-600 text-heading" : "bg-ink-800 text-slate-500 hover:text-slate-200"}`}>
                  <LayoutGrid size={16} className="inline" /> {n}
                </button>
              ))}
            </div>
            <button className="btn-primary" onClick={() => openForm(null)}><Plus size={16} /> Add camera</button>
          </div>
        }
      />

      <AnimatePresence>
        {summary.alarms.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: "auto", marginBottom: 24 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            className="overflow-hidden"
          >
            <div role="alert" className="flex animate-alarm items-center gap-3 rounded-xl border border-red-500 bg-red-500/10 px-5 py-4 text-red-200">
              <Flame className="shrink-0 text-red-400" />
              <div className="text-sm">
                <span className="font-semibold">Hazard confirmed</span> on {summary.alarms.map((c) => c.name).join(", ")}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {cameras && cameras.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-slate-400">
          <span><b className="text-emerald-400">{summary.online}</b> online</span>
          <span><b className={summary.offline ? "text-red-400" : "text-slate-300"}>{summary.offline}</b> offline</span>
          <span>{cameras.length} total</span>
          <span className="ml-auto flex items-center gap-2 text-xs">
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-400"}`} />
            {connected ? "Live updates" : "Reconnecting…"}
          </span>
        </div>
      )}

      {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      {cameras === null && !error && (
        <div className={`grid gap-4 ${COLS[density]}`}>{[0, 1, 2].map((i) => <Skeleton key={i} className="aspect-video" />)}</div>
      )}

      {cameras?.length === 0 && (
        <div className="card">
          <Empty
            icon={<Video size={40} />}
            text="No cameras yet. Add an IP camera, a video file or a webcam to start monitoring."
            action={<button className="btn-primary mt-2" onClick={() => openForm(null)}><Plus size={16} /> Add your first camera</button>}
          />
        </div>
      )}

      {cameras && cameras.length > 0 && (
        <motion.div variants={staggerContainer} initial="hidden" animate="show" className={`grid gap-4 ${COLS[density]}`}>
          {cameras.map((c) => (
            <CameraTile key={c.id} camera={c} state={states[c.id]} onOpen={() => setSelected(c)} />
          ))}
        </motion.div>
      )}

      {cameras && cameras.length > 0 && (
        <p className="mt-6 text-center text-xs text-slate-600">
          <Link to="/cameras" className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-300"><Settings2 size={12} /> Manage cameras</Link>
        </p>
      )}

      <FeedView camera={selected} state={selected ? states[selected.id] : undefined} onClose={() => setSelected(null)} onEdit={openForm} />
      <CameraFormModal open={formOpen} camera={editing} onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); reload(); }} />
    </>
  );
}
