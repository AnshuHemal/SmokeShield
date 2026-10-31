import { AnimatePresence, motion } from "framer-motion";
import { Camera as CameraIcon, Check, CheckSquare, Download, GraduationCap, History, Loader2, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ConfirmDialog, Modal } from "../components/Modal";
import { staggerContainer, staggerItem } from "../components/Motion";
import { ReviewButtons } from "../components/ReviewButtons";
import { Skeleton } from "../components/Skeleton";
import { useToast } from "../components/Toast";
import { Chip, Empty, LabelBadge, PageHeader, ReviewBadge } from "../components/ui";
import { useCameras } from "../hooks/useCameras";
import { useEvents } from "../hooks/useEvents";
import { api, formatDuration, Incident, IncidentQuery, isOngoing, Label, ReviewStatus, Stats, timeAgo } from "../lib/api";

const PAGE = 48;

export default function Incidents() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const { cameras } = useCameras();
  const { onIncident } = useEvents();

  const label = (params.get("label") as Label | null) ?? undefined;
  const status = (params.get("status") as ReviewStatus | null) ?? undefined;
  const cameraId = params.get("camera") ? Number(params.get("camera")) : undefined;

  const [items, setItems] = useState<Incident[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [open, setOpen] = useState<Incident | null>(null);
  const [deleting, setDeleting] = useState<Incident | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);

  const query = useCallback((offset = 0): IncidentQuery => ({ limit: PAGE, offset, label, status, camera_id: cameraId }), [label, status, cameraId]);

  const load = useCallback(async () => {
    try {
      const rows = await api.incidents(query());
      setItems(rows);
      setMore(rows.length === PAGE);
    } catch (e) {
      setItems([]);
      toast({ tone: "error", title: "Could not load incidents", description: e instanceof Error ? e.message : undefined });
    }
  }, [query, toast]);

  const loadStats = useCallback(() => api.stats().then(setStats).catch(() => {}), []);

  useEffect(() => { setItems(null); load(); }, [load]);
  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => onIncident(() => { load(); loadStats(); }), [onIncident, load, loadStats]);

  // New and extended incidents arrive as events; this slow poll is the safety net, and it also moves "Ongoing" to "Lasted".
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => { load(); setTick((n) => n + 1); }, 10000);
    return () => clearInterval(t);
  }, [load]);

  const setFilter = (key: string, value?: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    setParams(next, { replace: true });
  };

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const rows = await api.incidents(query(items?.length ?? 0));
      setItems((x) => [...(x ?? []), ...rows]);
      setMore(rows.length === PAGE);
    } finally {
      setLoadingMore(false);
    }
  };

  const review = async (inc: Incident, next: ReviewStatus) => {
    const previous = inc.status;
    const patch = (s: ReviewStatus) => {
      setItems((x) => x?.map((i) => (i.id === inc.id ? { ...i, status: s } : i)) ?? x);
      setOpen((o) => (o && o.id === inc.id ? { ...o, status: s } : o));
    };
    patch(next); // optimistic
    try {
      await api.reviewIncident(inc.id, next);
      loadStats();
      if (next !== "new") toast({ tone: "success", title: next === "real" ? "Marked as real" : "Marked as false alarm", description: "Saved for model retraining." });
    } catch (e) {
      patch(previous);
      toast({ tone: "error", title: "Could not save review", description: e instanceof Error ? e.message : undefined });
    }
  };

  const remove = async () => {
    if (!deleting) return;
    const inc = deleting;
    setDeleting(null);
    setOpen(null);
    try {
      await api.deleteIncident(inc.id);
      setItems((x) => x?.filter((i) => i.id !== inc.id) ?? x);
      setSelected((s) => { const n = new Set(s); n.delete(inc.id); return n; });
      loadStats();
      toast({ tone: "success", title: `Incident #${inc.id} deleted` });
    } catch (e) {
      toast({ tone: "error", title: "Could not delete incident", description: e instanceof Error ? e.message : undefined });
    }
  };

  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()); };

  // A refresh or another tab may have removed incidents already; never keep ids that are no longer on screen.
  useEffect(() => {
    if (!items) return;
    const ids = new Set(items.map((i) => i.id));
    setSelected((s) => (s.size && [...s].some((id) => !ids.has(id)) ? new Set([...s].filter((id) => ids.has(id))) : s));
  }, [items]);

  const removeSelected = async () => {
    const ids = [...selected];
    setConfirmBulk(false);
    try {
      const { deleted } = await api.deleteIncidents(ids);
      setItems((x) => x?.filter((i) => !selected.has(i.id)) ?? x);
      stopSelecting();
      loadStats();
      toast({ tone: "success", title: `${deleted} ${deleted === 1 ? "incident" : "incidents"} deleted` });
    } catch (e) {
      toast({ tone: "error", title: "Could not delete the selection", description: e instanceof Error ? e.message : undefined });
    }
  };

  const exportCsv = () => {
    const rows = [
      ["id", "time_utc", "label", "confidence", "source", "camera", "review"],
      ...(items ?? []).map((i) => [i.id, i.created_at, i.label, i.confidence, i.source, i.camera_name ?? "", i.status]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: "smokeshield-incidents.csv" }).click();
    URL.revokeObjectURL(url);
  };

  const reviewed = stats?.reviewed ?? 0;
  const filtered = !!(label || status || cameraId);

  return (
    <>
      <PageHeader
        title="Incidents"
        subtitle="Review each detection - your feedback measures accuracy and trains the next model."
        action={
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
              disabled={!items?.length}
              aria-pressed={selecting}
              className={`btn-ghost ${selecting ? "!border-ember-500 !text-ember-400" : ""}`}
            >
              <CheckSquare size={16} /> {selecting ? "Done" : "Select"}
            </button>
            <button onClick={exportCsv} disabled={!items?.length} className="btn-ghost"><Download size={16} /> CSV</button>
            <a
              href={reviewed ? api.trainingExportUrl : undefined}
              aria-disabled={!reviewed}
              title={reviewed ? "YOLO-format images + labels from reviewed incidents" : "Review some incidents first"}
              className={`btn-ghost ${reviewed ? "" : "pointer-events-none opacity-50"}`}
            >
              <GraduationCap size={16} /> Training set ({reviewed})
            </a>
          </div>
        }
      />

      {stats && stats.reviewed > 0 && <AccuracyBar stats={stats} />}

      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
          <Chip active={!label} onClick={() => setFilter("label")}>All types</Chip>
          <Chip active={label === "fire"} onClick={() => setFilter("label", "fire")}>Fire</Chip>
          <Chip active={label === "smoke"} onClick={() => setFilter("label", "smoke")}>Smoke</Chip>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by review status">
          <Chip active={!status} onClick={() => setFilter("status")}>Any status</Chip>
          <Chip active={status === "new"} onClick={() => setFilter("status", "new")}>Needs review</Chip>
          <Chip active={status === "real"} onClick={() => setFilter("status", "real")}>Real</Chip>
          <Chip active={status === "false_alarm"} onClick={() => setFilter("status", "false_alarm")}>False alarms</Chip>
        </div>
        {cameras && cameras.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <CameraIcon size={16} />
            <select value={cameraId ?? ""} onChange={(e) => setFilter("camera", e.target.value || undefined)} className="input !w-auto" aria-label="Filter by camera">
              <option value="">All cameras</option>
              {cameras.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {items === null && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64" />)}</div>
      )}

      {items?.length === 0 && (
        <div className="card">
          <Empty icon={<History size={36} />} text={filtered ? "No incidents match these filters." : "No incidents recorded - all clear."} />
        </div>
      )}

      {items && items.length > 0 && (
        <motion.div key={`${label}-${status}-${cameraId}`} variants={staggerContainer} initial="hidden" animate="show" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {items.map((i) => (
              <motion.article
                key={i.id}
                layout
                variants={staggerItem}
                exit={{ opacity: 0, scale: 0.95 }}
                className={`card overflow-hidden transition-shadow ${selected.has(i.id) ? "ring-2 ring-ember-500" : ""}`}
              >
                <button
                  onClick={() => (selecting ? toggle(i.id) : setOpen(i))}
                  className="group relative block aspect-video w-full bg-black on-media"
                  aria-label={selecting ? `${selected.has(i.id) ? "Deselect" : "Select"} incident ${i.id}` : `Open incident ${i.id}`}
                  aria-pressed={selecting ? selected.has(i.id) : undefined}
                >
                  {i.snapshot_url && <img src={i.snapshot_url} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />}
                  <div className="absolute left-3 top-3"><LabelBadge label={i.label} /></div>
                  <div className="absolute right-3 top-3 rounded-md bg-black/60 px-2 py-0.5 text-xs font-semibold tabular-nums text-white backdrop-blur">{Math.round(i.confidence * 100)}%</div>
                  {selecting && (
                    <div className={`absolute bottom-3 left-3 flex h-6 w-6 items-center justify-center rounded-md border-2 ${selected.has(i.id) ? "border-ember-500 bg-ember-500 text-white" : "border-white/80 bg-black/50 text-transparent"}`}>
                      <Check size={16} strokeWidth={3} />
                    </div>
                  )}
                </button>
                <div className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-heading">{i.camera_name ?? `${i.source[0].toUpperCase()}${i.source.slice(1)} upload`}</div>
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500" title={new Date(i.created_at).toLocaleString()}>
                        <span>{timeAgo(i.created_at)}</span>
                        <Duration incident={i} />
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <ReviewBadge status={i.status} />
                      <button
                        onClick={() => setDeleting(i)}
                        disabled={selecting}
                        title="Delete incident"
                        aria-label={`Delete incident ${i.id}`}
                        className="rounded-md p-1.5 text-slate-500 transition hover:bg-red-500/10 hover:text-red-300 focus-visible:bg-red-500/10 focus-visible:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <ReviewButtons status={i.status} onChange={(s) => review(i, s)} />
                </div>
              </motion.article>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {more && (
        <div className="mt-6 flex justify-center">
          <button className="btn-ghost" onClick={loadMore} disabled={loadingMore}>
            {loadingMore && <Loader2 size={16} className="animate-spin" />} Load more
          </button>
        </div>
      )}

      <AnimatePresence>
        {selecting && (
          <motion.div
            role="toolbar"
            aria-label="Selection actions"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            className="card fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3 p-3 pl-5 shadow-2xl shadow-black/40"
          >
            <span className="text-sm text-slate-300" aria-live="polite">
              <b className="tabular-nums text-heading">{selected.size}</b> selected
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-ghost"
                onClick={() => setSelected(selected.size === items?.length ? new Set() : new Set((items ?? []).map((i) => i.id)))}
              >
                {selected.size === items?.length ? "Clear" : `Select all${more ? " loaded" : ""}`}
              </button>
              <button className="btn bg-red-600 text-white hover:bg-red-700" disabled={!selected.size} onClick={() => setConfirmBulk(true)}>
                <Trash2 size={16} /> Delete
              </button>
              <button className="btn-ghost" onClick={stopSelecting} aria-label="Cancel selection"><X size={16} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Detail incident={open} onClose={() => setOpen(null)} onReview={review} onDelete={setDeleting} />
      <ConfirmDialog
        open={confirmBulk}
        title={`Delete ${selected.size} ${selected.size === 1 ? "incident" : "incidents"}?`}
        message="They and their snapshots are permanently removed, and they will no longer count toward the accuracy score or retraining data."
        confirmLabel={`Delete ${selected.size}`}
        onConfirm={removeSelected}
        onCancel={() => setConfirmBulk(false)}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete incident?"
        message="The incident and its snapshots are permanently removed, and it will no longer count toward retraining data."
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function Duration({ incident }: { incident: Incident }) {
  if (isOngoing(incident)) {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-red-300">
        <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" /><span className="relative h-2 w-2 rounded-full bg-red-500" /></span>
        Ongoing
      </span>
    );
  }
  return incident.duration_s != null && incident.duration_s >= 1 ? <span>· lasted {formatDuration(incident.duration_s)}</span> : null;
}

function AccuracyBar({ stats }: { stats: Stats }) {
  const real = (stats.real / stats.reviewed) * 100;
  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="card mb-6 p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-heading">Alert accuracy <span className="font-normal text-slate-500">· from {stats.reviewed} reviewed incidents</span></span>
        <span className="text-slate-400"><b className="text-emerald-300">{stats.real}</b> real · <b className="text-amber-300">{stats.false_alarms}</b> false alarms</span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-amber-500/40" role="img" aria-label={`${Math.round(real)} percent of reviewed alerts were real`}>
        <motion.div className="h-full bg-emerald-400" initial={{ width: 0 }} animate={{ width: `${real}%` }} transition={{ duration: 0.8, ease: "easeOut" }} />
      </div>
    </motion.div>
  );
}

function Detail({ incident, onClose, onReview, onDelete }: { incident: Incident | null; onClose: () => void; onReview: (i: Incident, s: ReviewStatus) => void; onDelete: (i: Incident) => void }) {
  const [clean, setClean] = useState(false);
  useEffect(() => setClean(false), [incident?.id]);
  return (
    <Modal open={!!incident} onClose={onClose} title={incident ? `Incident #${incident.id}` : undefined} width="max-w-4xl">
      {incident && (
        <div className="grid gap-6 p-6 lg:grid-cols-[1fr_260px]">
          <div>
            <img src={(clean && incident.raw_url) || incident.snapshot_url || ""} alt="Incident snapshot" className="w-full rounded-lg bg-black" />
            {incident.raw_url && (
              <div className="mt-3 flex gap-2">
                <Chip active={!clean} onClick={() => setClean(false)}>With detections</Chip>
                <Chip active={clean} onClick={() => setClean(true)}>Original frame</Chip>
              </div>
            )}
          </div>
          <div className="space-y-5 text-sm">
            <div className="flex flex-wrap gap-2"><LabelBadge label={incident.label} /><ReviewBadge status={incident.status} /></div>
            <dl className="space-y-2">
              <Row k="Confidence" v={`${Math.round(incident.confidence * 100)}%`} />
              <Row k="Camera" v={incident.camera_name ?? "–"} />
              <Row k="Source" v={incident.source} />
              <Row k="Detected" v={new Date(incident.created_at).toLocaleString()} />
              <Row k="Duration" v={isOngoing(incident) ? "Ongoing" : formatDuration(incident.duration_s ?? 0)} />
              <Row k="Objects" v={String(incident.detections.length || 1)} />
            </dl>
            <div>
              <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Was this a real hazard?</div>
              <ReviewButtons size="md" status={incident.status} onChange={(s) => onReview(incident, s)} />
              <p className="mt-2 text-xs text-slate-500">Your answer feeds the accuracy score and the retraining export.</p>
            </div>
            <button onClick={() => onDelete(incident)} className="btn-ghost w-full text-red-300 hover:bg-red-500/10"><Trash2 size={16} /> Delete incident</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{k}</dt>
      <dd className="truncate text-right capitalize text-slate-200">{v}</dd>
    </div>
  );
}
