import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, FileBox, Loader2, ShieldAlert, UploadCloud } from "lucide-react";
import { DragEvent, FormEvent, useRef, useState } from "react";
import { api, ModelMeta, ModelVersion } from "../../lib/api";
import { Modal } from "../Modal";
import { useToast } from "../Toast";
import { MetricKey } from "./format";

const METRIC_FIELDS: { key: MetricKey; label: string; hint: string }[] = [
  { key: "map50", label: "mAP50", hint: "e.g. 76.7" },
  { key: "map50_95", label: "mAP50-95", hint: "e.g. 43.9" },
  { key: "precision", label: "Precision", hint: "e.g. 76.1" },
  { key: "recall", label: "Recall", hint: "e.g. 69.5" },
];

interface Props {
  open: boolean;
  model: ModelVersion | null; // null = upload a new one
  onClose: () => void;
  onSaved: (m: ModelVersion) => void;
}

export function ModelFormModal({ open, model, onClose, onSaved }: Props) {
  return (
    <Modal open={open} onClose={onClose} title={model ? `Edit ${model.name}` : "Upload a model"} width="max-w-2xl">
      {open && <Form key={model?.id ?? "new"} model={model} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

const toInput = (v: number | null) => (v == null ? "" : String(+(v * 100).toFixed(2)));

function Form({ model, onClose, onSaved }: Omit<Props, "open">) {
  const toast = useToast();
  const editing = !!model;
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(model?.name ?? "");
  const [notes, setNotes] = useState(model?.notes ?? "");
  const [metrics, setMetrics] = useState<Record<MetricKey, string>>({
    map50: toInput(model?.map50 ?? null), map50_95: toInput(model?.map50_95 ?? null),
    precision: toInput(model?.precision ?? null), recall: toInput(model?.recall ?? null),
  });
  const [file, setFile] = useState<File | null>(null);
  const [trust, setTrust] = useState(false);
  const [phase, setPhase] = useState<"idle" | "uploading" | "processing" | "saving">("idle");
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const busy = phase !== "idle";

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".pt")) return setError("Choose a YOLO weights file ending in .pt");
    setError(null);
    setFile(f);
    if (!name.trim()) setName(f.name.replace(/\.pt$/i, "").replace(/[_-]+/g, " ").trim());
  };

  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); };

  /** "76.7" -> 0.767; blank -> null. Throws a readable message for bad input. */
  const parseMetrics = (): Record<MetricKey, number | null> => {
    const out = {} as Record<MetricKey, number | null>;
    for (const { key, label } of METRIC_FIELDS) {
      const raw = metrics[key].trim();
      if (!raw) { out[key] = null; continue; }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`${label} must be a percentage between 0 and 100.`);
      out[key] = n / 100;
    }
    return out;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Give this version a name.");
    if (!editing && !file) return setError("Choose a .pt weights file to upload.");
    if (!editing && !trust) return setError("Please confirm you trust this file (see the notice above).");
    let m: Record<MetricKey, number | null>;
    try { m = parseMetrics(); } catch (err) { return setError((err as Error).message); }

    try {
      let saved: ModelVersion;
      if (editing) {
        setPhase("saving");
        const patch: ModelMeta = { name: name.trim(), notes: notes.trim() || null, ...m };
        saved = await api.updateModel(model!.id, patch);
      } else {
        setPhase("uploading");
        saved = await api.uploadModel(
          file!,
          { name: name.trim(), notes: notes.trim() || null, ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null)) },
          { onProgress: setPct, onProcessing: () => setPhase("processing") },
        );
      }
      toast({ tone: "success", title: editing ? "Model updated" : "Model added", description: editing ? saved.name : `${saved.name} is ready. Activate it when you want it live.` });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPhase("idle");
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6 p-6">
      {!editing && (
        <section className="space-y-4">
          <input ref={fileInput} type="file" accept=".pt" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            className={`flex w-full items-center gap-4 rounded-xl border border-dashed p-5 text-left transition ${drag ? "border-ember-500 bg-ember-500/5" : "border-ink-600 hover:border-ember-500"} disabled:opacity-60`}
          >
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-ink-800 text-ember-400">
              {file ? <FileBox size={22} /> : <UploadCloud size={22} />}
            </div>
            <div className="min-w-0">
              <div className="truncate font-medium text-heading">{file ? file.name : "Drop a .pt file here or click to browse"}</div>
              <div className="text-xs text-slate-500">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · click to choose a different file` : "Ultralytics YOLO weights with a fire and/or smoke class (best.pt from training)"}</div>
            </div>
          </button>

          <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
            <ShieldAlert size={18} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Only upload weights you trust</div>
              <p className="mt-1 text-xs leading-relaxed">PyTorch model files can run code when they are loaded. Upload files you trained yourself or got from a source you trust, never from an unknown download.</p>
              <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} disabled={busy} className="h-4 w-4 accent-orange-600" />
                I trained this file or trust where it came from
              </label>
            </div>
          </div>
        </section>
      )}

      <section className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-300">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} disabled={busy} placeholder="e.g. yolo11s · full D-Fire · 40 epochs" className="input" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-300">Notes <span className="font-normal text-slate-500">(optional)</span></span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} disabled={busy} placeholder="Dataset, image size, what changed since the last version…" className="input resize-none" />
        </label>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-heading">Accuracy <span className="font-normal text-slate-500">(optional)</span></h3>
        <p className="mb-3 mt-0.5 text-xs text-slate-500">Copy these from your validation table (the “all” row) as percentages. They are shown on the model card so versions can be compared.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {METRIC_FIELDS.map(({ key, label, hint }) => (
            <label key={key} className="block">
              <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
              <span className="relative block">
                <input type="number" inputMode="decimal" min={0} max={100} step="0.1" value={metrics[key]} onChange={(e) => setMetrics((s) => ({ ...s, [key]: e.target.value }))} disabled={busy} placeholder={hint} className="input pr-7" />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">%</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <AnimatePresence initial={false}>
        {(phase === "uploading" || phase === "processing") && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden" role="status">
            <div className="rounded-xl bg-ink-800 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm text-slate-300">
                <Loader2 size={15} className="animate-spin text-ember-400" />
                {phase === "uploading" ? `Uploading… ${pct}%` : "Loading the model and measuring its speed on this server…"}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
                {phase === "uploading" ? (
                  <motion.div className="h-full bg-ember-500" animate={{ width: `${pct}%` }} />
                ) : (
                  <div className="h-full w-full animate-shimmer bg-gradient-to-r from-ember-500/20 via-ember-500 to-ember-500/20 bg-[length:200%_100%]" />
                )}
              </div>
            </div>
          </motion.div>
        )}
        {error && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</motion.div>
        )}
      </AnimatePresence>

      <div className="flex justify-end gap-3 border-t border-ink-700 pt-5">
        <button type="button" onClick={onClose} disabled={busy} className="btn-ghost">Cancel</button>
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? <Loader2 size={16} className="animate-spin" /> : editing ? <CheckCircle2 size={16} /> : <UploadCloud size={16} />}
          {editing ? "Save changes" : "Upload & validate"}
        </button>
      </div>
    </form>
  );
}
