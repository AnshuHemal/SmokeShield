import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, FileVideo, Loader2, Radio, ScanEye, Upload, Webcam } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { api, Camera, CameraInput, DetailSize, Point, SourceType } from "../../lib/api";
import { Modal } from "../Modal";
import { Switch } from "../Switch";
import { useToast } from "../Toast";
import { ZoneEditor } from "./ZoneEditor";

const SOURCES: { type: SourceType; label: string; hint: string; icon: typeof Radio }[] = [
  { type: "stream", label: "IP / RTSP stream", hint: "rtsp://user:pass@192.168.1.20:554/stream1", icon: Radio },
  { type: "file", label: "Video file", hint: "Looped, processed on the server", icon: FileVideo },
  { type: "device", label: "Server webcam", hint: "A camera plugged into the PC running SmokeShield", icon: Webcam },
];

const PRESETS: readonly { name: string; note: string; confidence: number; confirm_frames: number; confirm_window: number; cooldown: number; imgsz: DetailSize | null }[] = [
  { name: "Sensitive", note: "Kitchens, labs", confidence: 0.3, confirm_frames: 2, confirm_window: 3, cooldown: 30, imgsz: null },
  { name: "Balanced", note: "Offices, warehouses", confidence: 0.4, confirm_frames: 3, confirm_window: 5, cooldown: 30, imgsz: null },
  { name: "Strict", note: "Outdoor, steam / dust", confidence: 0.55, confirm_frames: 4, confirm_window: 6, cooldown: 60, imgsz: null },
  // Small flames are found in only a fraction of frames, so accept a lower score and fewer hits, and give the model more pixels.
  { name: "Close-range", note: "Lighter, candle, small flames", confidence: 0.25, confirm_frames: 2, confirm_window: 4, cooldown: 30, imgsz: 960 },
];

// Measured on this project's model and an Intel i5-9500 CPU (median per frame): 198 ms, 394 ms, 704 ms.
const DETAIL_OPTIONS: { value: DetailSize | null; label: string }[] = [
  { value: null, label: "Standard (640) - fastest" },
  { value: 960, label: "High (960) - about 2x slower, finds smaller flames" },
  { value: 1280, label: "Maximum (1280) - about 3.5x slower, smallest flames" },
];

const COOLDOWNS = [15, 30, 60, 120, 300, 600, 1800, 3600];
const cooldownLabel = (s: number) => (s < 60 ? `${s} seconds` : s < 3600 ? `${s / 60} min` : "1 hour");
const WORKER_FPS = 4; // keep in sync with SMOKESHIELD_WORKER_FPS

interface FormState extends Omit<CameraInput, "zone"> {
  zone: Point[];
  zoneEnabled: boolean;
}

const blank: FormState = {
  name: "", source_type: "stream", source: "", enabled: true,
  confidence: 0.4, confirm_frames: 3, confirm_window: 5, cooldown: 30, imgsz: null, zone: [], zoneEnabled: false,
};

// Pick only editable fields: spreading the whole Camera would send id/created_at, which the API rejects.
const fromCamera = (c: Camera): FormState => ({
  name: c.name, source_type: c.source_type, source: c.source, enabled: c.enabled,
  confidence: c.confidence, confirm_frames: c.confirm_frames, confirm_window: c.confirm_window, cooldown: c.cooldown, imgsz: c.imgsz ?? null,
  zone: c.zone ?? [], zoneEnabled: !!c.zone,
});

interface Props {
  open: boolean;
  camera: Camera | null; // null = create
  onClose: () => void;
  onSaved: (c: Camera) => void;
}

export function CameraFormModal({ open, camera, onClose, onSaved }: Props) {
  return (
    <Modal open={open} onClose={onClose} title={camera ? `Edit ${camera.name}` : "Add camera"} width="max-w-3xl">
      {/* remount on open so every session starts from a clean form */}
      {open && <Form key={camera?.id ?? "new"} camera={camera} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function Form({ camera, onClose, onSaved }: Omit<Props, "open">) {
  const toast = useToast();
  const [f, setF] = useState<FormState>(camera ? fromCamera(camera) : blank);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [upload, setUpload] = useState<{ pct: number; name: string; done: boolean } | null>(
    camera?.source_type === "file" ? { pct: 100, name: "Existing video", done: true } : null,
  );
  const [preview, setPreview] = useState<{ url: string | null; loading: boolean; error: string | null }>({ url: null, loading: false, error: null });
  const fileInput = useRef<HTMLInputElement>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => () => { if (preview.url) URL.revokeObjectURL(preview.url); }, [preview.url]);

  const setWindow = (n: number, m: number) => {
    const w = Math.min(10, Math.max(1, m));
    setF((s) => ({ ...s, confirm_window: w, confirm_frames: Math.min(Math.max(1, n), w) }));
  };

  const preset = PRESETS.find((p) => p.confidence === f.confidence && p.confirm_frames === f.confirm_frames && p.confirm_window === f.confirm_window && p.cooldown === f.cooldown && p.imgsz === f.imgsz);

  const pickType = (type: SourceType) => {
    if (type === f.source_type) return;
    setF((s) => ({ ...s, source_type: type, source: type === "device" ? "0" : "", zone: [] }));
    setUpload(null);
    setPreview({ url: null, loading: false, error: null });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setUpload({ pct: 0, name: file.name, done: false });
    try {
      const res = await api.uploadVideo(file, (pct) => setUpload({ pct, name: file.name, done: false }));
      set("source", res.filename);
      setUpload({ pct: 100, name: `${file.name} (${res.size_mb} MB)`, done: true });
    } catch (e) {
      setUpload(null);
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  };

  const loadPreview = async () => {
    setPreview({ url: null, loading: true, error: null });
    try {
      const sameAsSaved = camera && camera.source_type === f.source_type && camera.source === f.source;
      const url = sameAsSaved ? await api.snapshot(camera.id) : await api.previewFrame(f.source_type, f.source);
      setPreview({ url, loading: false, error: null });
    } catch (e) {
      setPreview({ url: null, loading: false, error: e instanceof Error ? e.message : "Could not load a frame" });
    }
  };

  const sourceReady = f.source.trim().length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!f.name.trim()) return setError("Give the camera a name.");
    if (!sourceReady) return setError(f.source_type === "file" ? "Upload a video file first." : "Enter the camera source.");
    if (f.zoneEnabled && f.zone.length < 3) return setError("A zone needs at least 3 points - or turn the zone off.");

    const { zone, zoneEnabled, ...rest } = f;
    const body: CameraInput = { ...rest, name: f.name.trim(), zone: zoneEnabled ? zone : null };
    setSaving(true);
    try {
      const saved = camera ? await api.updateCamera(camera.id, body) : await api.createCamera(body);
      toast({ tone: "success", title: camera ? "Camera updated" : "Camera added", description: saved.name });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the camera");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-7 p-6">
      {/* ---- basics ---- */}
      <section className="space-y-4">
        <Field label="Camera name">
          <input value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={80} placeholder="e.g. Warehouse – Loading dock" className="input" autoFocus />
        </Field>

        <div>
          <div className="mb-2 text-sm font-medium text-slate-300">Source</div>
          <div className="grid gap-3 sm:grid-cols-3">
            {SOURCES.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                type="button"
                onClick={() => pickType(type)}
                aria-pressed={f.source_type === type}
                className={`flex items-center gap-3 rounded-xl border p-3 text-left text-sm transition ${f.source_type === type ? "border-ember-500 bg-ember-500/10 text-heading" : "border-ink-600 bg-ink-800 text-slate-400 hover:border-ink-600 hover:text-slate-200"}`}
              >
                <Icon size={18} className={f.source_type === type ? "text-ember-400" : ""} /> {label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">{SOURCES.find((s) => s.type === f.source_type)!.hint}</p>
        </div>

        {f.source_type === "stream" && (
          <Field label="Stream URL">
            <input value={f.source} onChange={(e) => set("source", e.target.value)} placeholder="rtsp://user:pass@192.168.1.20:554/stream1" className="input font-mono text-sm" spellCheck={false} />
          </Field>
        )}

        {f.source_type === "device" && (
          <Field label="Camera index">
            <select value={f.source} onChange={(e) => set("source", e.target.value)} className="input">
              {[0, 1, 2, 3].map((i) => <option key={i} value={i}>Camera {i}{i === 0 ? " (default)" : ""}</option>)}
            </select>
          </Field>
        )}

        {f.source_type === "file" && (
          <div>
            <input ref={fileInput} type="file" accept="video/*" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
            <button type="button" onClick={() => fileInput.current?.click()} disabled={upload ? !upload.done : false} className="flex w-full items-center gap-3 rounded-xl border border-dashed border-ink-600 p-4 text-left text-sm text-slate-400 transition hover:border-ember-500 hover:text-slate-200">
              {upload?.done ? <CheckCircle2 className="text-emerald-400" size={20} /> : upload ? <Loader2 className="animate-spin text-ember-400" size={20} /> : <Upload size={20} />}
              <span className="flex-1">
                {upload ? upload.name : "Choose a video file (MP4, AVI, MOV, MKV)"}
                {upload && !upload.done && (
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-ink-700">
                    <motion.span className="block h-full bg-ember-500" animate={{ width: `${upload.pct}%` }} />
                  </span>
                )}
              </span>
              {upload?.done && <span className="text-xs text-slate-500">Replace</span>}
            </button>
          </div>
        )}
      </section>

      {/* ---- sensitivity ---- */}
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-heading">Detection sensitivity</h3>
          <p className="text-xs text-slate-500">Tune per camera - a kitchen and a warehouse should not share one threshold.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              aria-pressed={preset?.name === p.name}
              onClick={() => setF((s) => ({ ...s, confidence: p.confidence, confirm_frames: p.confirm_frames, confirm_window: p.confirm_window, cooldown: p.cooldown, imgsz: p.imgsz }))}
              className={`rounded-xl border p-3 text-left transition ${preset?.name === p.name ? "border-ember-500 bg-ember-500/10" : "border-ink-600 bg-ink-800 hover:border-slate-500"}`}
            >
              <div className="text-sm font-semibold text-heading">{p.name}</div>
              <div className="text-xs text-slate-500">{p.note}</div>
            </button>
          ))}
        </div>

        <Field label={`Minimum confidence - ${Math.round(f.confidence * 100)}%`} hint="Lower catches more, but raises false alarms.">
          <input type="range" min={0.1} max={0.9} step={0.05} value={f.confidence} onChange={(e) => set("confidence", Number(e.target.value))} className="w-full accent-orange-500" />
        </Field>

        <Field label="Detail level" hint="How many pixels the model looks at. Small flames (a lighter or match) fill under 1% of the picture and are often missed at Standard; more detail finds them but costs speed, and all cameras share one model.">
          <select value={f.imgsz ?? ""} onChange={(e) => set("imgsz", e.target.value ? (Number(e.target.value) as DetailSize) : null)} className="input">
            {DETAIL_OPTIONS.map((o) => <option key={o.label} value={o.value ?? ""}>{o.label}</option>)}
          </select>
        </Field>

        <div>
          <div className="text-sm font-medium text-slate-300">Temporal confirmation</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-400">
            Alarm when seen in
            <Stepper value={f.confirm_frames} min={1} max={f.confirm_window} onChange={(n) => setWindow(n, f.confirm_window)} label="Frames required" />
            of the last
            <Stepper value={f.confirm_window} min={1} max={10} onChange={(m) => setWindow(f.confirm_frames, m)} label="Window size" />
            frames
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            About {(f.confirm_frames / WORKER_FPS).toFixed(1)}s to confirm at full speed. Isolated one-frame glitches never trigger an alarm, a single very confident detection (75%+) confirms at once, and the alarm stays on for a few seconds after the last sighting so a flickering flame does not blink.
          </p>
        </div>

        <Field label="Merge repeated detections within" hint="A fire that flickers or comes back inside this time extends the same incident instead of creating a new one. Nothing is ever skipped.">
          <select value={f.cooldown} onChange={(e) => set("cooldown", Number(e.target.value))} className="input">
            {COOLDOWNS.map((c) => <option key={c} value={c}>{cooldownLabel(c)}</option>)}
          </select>
        </Field>
      </section>

      {/* ---- zone ---- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-heading"><ScanEye size={16} /> Detection zone</h3>
            <p className="text-xs text-slate-500">Ignore areas such as a window, a kitchen hob or a street outside.</p>
          </div>
          <Switch checked={f.zoneEnabled} onChange={(v) => set("zoneEnabled", v)} label="Limit detection to a zone" />
        </div>

        <AnimatePresence initial={false}>
          {f.zoneEnabled && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              {preview.url ? (
                <ZoneEditor imageUrl={preview.url} value={f.zone} onChange={(z) => set("zone", z)} />
              ) : (
                <div className="grid place-items-center gap-3 rounded-xl border border-dashed border-ink-600 p-8 text-center text-sm text-slate-500">
                  {preview.error && <p className="text-red-300">{preview.error}</p>}
                  <button type="button" onClick={loadPreview} disabled={!sourceReady || preview.loading} className="btn-ghost">
                    {preview.loading ? <Loader2 size={16} className="animate-spin" /> : <ScanEye size={16} />}
                    {preview.loading ? "Grabbing a frame…" : "Load a preview frame to draw the zone"}
                  </button>
                  {!sourceReady && <p className="text-xs">Set the camera source first.</p>}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <div className="flex items-center justify-between rounded-xl bg-ink-800 p-4">
        <div>
          <div className="text-sm font-medium text-heading">Start monitoring</div>
          <div className="text-xs text-slate-500">Disabled cameras are saved but not processed.</div>
        </div>
        <Switch checked={f.enabled} onChange={(v) => set("enabled", v)} label="Enable camera" />
      </div>

      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex justify-end gap-3 border-t border-ink-700 pt-5">
        <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
        <button type="submit" disabled={saving || (upload ? !upload.done : false)} className="btn-primary">
          {saving && <Loader2 size={16} className="animate-spin" />} {camera ? "Save changes" : "Add camera"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <span className="inline-flex items-center overflow-hidden rounded-lg border border-ink-600 bg-ink-800" role="group" aria-label={label}>
      <button type="button" aria-label={`Decrease ${label}`} onClick={() => onChange(Math.max(min, value - 1))} className="px-2.5 py-1 text-slate-400 hover:bg-ink-700 hover:text-heading">−</button>
      <span className="w-7 text-center font-semibold tabular-nums text-heading">{value}</span>
      <button type="button" aria-label={`Increase ${label}`} onClick={() => onChange(Math.min(max, value + 1))} className="px-2.5 py-1 text-slate-400 hover:bg-ink-700 hover:text-heading">+</button>
    </span>
  );
}
