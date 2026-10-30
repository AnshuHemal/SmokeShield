import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { Cpu, Upload } from "lucide-react";
import { ReactNode, useMemo, useState } from "react";
import { ActiveModelCard } from "../components/models/ActiveModelCard";
import { deltaVs, speedVs } from "../components/models/format";
import { ModelFormModal } from "../components/models/ModelFormModal";
import { ModelAction, ModelCard } from "../components/models/ModelCard";
import { ConfirmDialog } from "../components/Modal";
import { staggerContainer } from "../components/Motion";
import { Skeleton } from "../components/Skeleton";
import { useToast } from "../components/Toast";
import { Empty, PageHeader } from "../components/ui";
import { useEvents } from "../hooks/useEvents";
import { announceModelChange, useModels } from "../hooks/useModels";
import { api, ModelVersion } from "../lib/api";

type Working = { id: number; action: ModelAction | "rollback" } | null;
type Pending = { kind: "activate" | "delete" | "rollback"; model: ModelVersion } | null;

export default function Models() {
  const { models, active, previous, error, reload } = useModels();
  const { states } = useEvents();
  const toast = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ModelVersion | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [working, setWorking] = useState<Working>(null);

  const camerasOnline = useMemo(() => Object.values(states).filter((s) => ["ok", "smoke", "fire"].includes(s.status)).length, [states]);

  const openForm = (m: ModelVersion | null) => { setEditing(m); setFormOpen(true); };

  /** Runs one registry action with a busy state, a refresh, and a toast either way. */
  const run = async (id: number, action: NonNullable<Working>["action"], job: () => Promise<ModelVersion | void>, ok: (r: ModelVersion | void) => { title: string; description?: string }) => {
    setWorking({ id, action });
    try {
      const result = await job();
      await reload();
      if (action === "activate" || action === "rollback") announceModelChange();
      toast({ tone: "success", ...ok(result) });
    } catch (e) {
      toast({ tone: "error", title: `Could not ${action === "rollback" ? "roll back" : action}`, description: e instanceof Error ? e.message : undefined, duration: 8000 });
    } finally {
      setWorking(null);
    }
  };

  const confirm = () => {
    if (!pending) return;
    const { kind, model: m } = pending;
    setPending(null);
    if (kind === "activate") run(m.id, "activate", () => api.activateModel(m.id), () => ({ title: `Now serving “${m.name}”`, description: "Cameras picked it up on their next frame." }));
    if (kind === "rollback") run(m.id, "rollback", () => api.rollbackModel(), (r) => ({ title: `Rolled back to “${(r as ModelVersion).name}”` }));
    if (kind === "delete") run(m.id, "delete", () => api.deleteModel(m.id), () => ({ title: "Model deleted", description: m.name }));
  };

  const benchmark = (m: ModelVersion) =>
    run(m.id, "benchmark", () => api.benchmarkModel(m.id), (r) => ({ title: `${m.name}: ${Math.round((r as ModelVersion).latency_ms ?? 0)} ms per frame`, description: "Median on this server." }));

  const locked = working !== null;

  return (
    <>
      <PageHeader
        title="Models"
        subtitle="Upload new weights, compare versions, and switch the live model without restarting anything."
        action={<button className="btn-primary" onClick={() => openForm(null)}><Upload size={16} /> Upload model</button>}
      />

      {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      {models === null && !error ? (
        <div className="space-y-6"><Skeleton className="h-64" /><div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div></div>
      ) : (
        <LayoutGroup>
          <ActiveModelCard
            model={active}
            previous={previous}
            rollingBack={working?.action === "rollback"}
            disabled={locked}
            camerasOnline={camerasOnline}
            onRollback={() => previous && setPending({ kind: "rollback", model: previous })}
            onUpload={() => openForm(null)}
          />

          <div className="mb-3 mt-8 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-heading">All versions <span className="font-normal text-slate-500">· {models?.length ?? 0}</span></h2>
            <span className="text-xs text-slate-500">Newest first</span>
          </div>

          {models?.length === 0 ? (
            <div className="card"><Empty icon={<Cpu size={36} />} text="No model versions registered yet." action={<button className="btn-primary mt-2" onClick={() => openForm(null)}><Upload size={16} /> Upload your first model</button>} /></div>
          ) : (
            <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid gap-4 lg:grid-cols-2">
              <AnimatePresence initial={false}>
                {models?.map((m) => (
                  <ModelCard
                    key={m.id}
                    model={m}
                    live={active}
                    busy={working?.id === m.id && working.action !== "rollback" ? (working.action as ModelAction) : null}
                    locked={locked}
                    onActivate={() => setPending({ kind: "activate", model: m })}
                    onBenchmark={() => benchmark(m)}
                    onEdit={() => openForm(m)}
                    onDelete={() => setPending({ kind: "delete", model: m })}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </LayoutGroup>
      )}

      <ModelFormModal open={formOpen} model={editing} onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); reload(); }} />

      <ConfirmDialog
        open={!!pending}
        tone={pending?.kind === "delete" ? "danger" : "primary"}
        title={pending?.kind === "activate" ? "Make this the live model?" : pending?.kind === "rollback" ? "Roll back the live model?" : "Delete this model?"}
        confirmLabel={pending?.kind === "activate" ? "Activate" : pending?.kind === "rollback" ? "Roll back" : "Delete"}
        message={pending && <Summary pending={pending} live={active} />}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

function Summary({ pending, live }: { pending: NonNullable<Pending>; live: ModelVersion | null }): ReactNode {
  const m = pending.model;
  if (pending.kind === "delete") {
    return <p><b className="text-heading">{m.name}</b> and its weights file ({m.size_mb} MB) will be removed from disk. This cannot be undone.</p>;
  }
  const d = deltaVs(m, live, "map50");
  const speed = speedVs(m, live);
  return (
    <div className="space-y-3">
      <p>
        <b className="text-heading">{m.name}</b> will serve detections for all cameras within a few seconds. Cameras keep running with no restart, and you can switch back at any time.
      </p>
      {(d != null || speed) && (
        <ul className="space-y-1.5 rounded-lg bg-ink-800 p-3 text-xs">
          {d != null && (
            <li className="flex justify-between"><span>mAP50 vs the current model</span><b className={d > 0 ? "text-emerald-300" : "text-red-300"}>{d > 0 ? "+" : "−"}{Math.abs(d * 100).toFixed(1)} points</b></li>
          )}
          {speed && <li className="flex justify-between"><span>Speed on this server</span><b className={speed.slower ? "text-amber-300" : "text-emerald-300"}>{speed.text}</b></li>}
        </ul>
      )}
      {speed?.slower && <p className="text-xs text-amber-300">A slower model lowers each camera's frame rate when several run at once.</p>}
    </div>
  );
}
