import { FileVideo, Loader2, UploadCloud } from "lucide-react";
import { DragEvent, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ConfidenceSlider, PageHeader, StatCard } from "../components/ui";
import { api, COLORS, ImageResult, VideoResult } from "../lib/api";

type Result = { kind: "image"; data: ImageResult } | { kind: "video"; data: VideoResult };

export default function Analyze({ ready }: { ready: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [conf, setConf] = useState(0.4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [drag, setDrag] = useState(false);

  const run = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      if (file.type.startsWith("image/")) setResult({ kind: "image", data: await api.detectImage(file, conf) });
      else if (file.type.startsWith("video/")) setResult({ kind: "video", data: await api.detectVideo(file, conf) });
      else throw new Error("Please choose an image or a video file.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    run(e.dataTransfer.files[0]);
  };

  return (
    <>
      <PageHeader
        title="Analyze Media"
        subtitle="Upload an image or video clip to check it for fire and smoke."
        action={<ConfidenceSlider value={conf} onChange={setConf} />}
      />

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => ready && !busy && input.current?.click()}
        className={`card grid cursor-pointer place-items-center border-dashed p-10 text-center transition ${drag ? "border-ember-500 bg-ember-500/5" : ""} ${!ready ? "cursor-not-allowed opacity-50" : ""}`}
      >
        <input ref={input} type="file" accept="image/*,video/*" hidden onChange={(e) => { run(e.target.files?.[0]); e.target.value = ""; }} />
        {busy ? (
          <div className="flex items-center gap-3 text-slate-300"><Loader2 className="animate-spin" /> Running YOLO inference…</div>
        ) : (
          <>
            <UploadCloud size={36} className="text-ember-400" />
            <div className="mt-3 font-medium text-white">Drop a file here or click to browse</div>
            <div className="mt-1 text-xs text-slate-500">JPG, PNG, MP4, AVI, MOV · up to 100 MB</div>
          </>
        )}
      </div>

      {error && <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      {result?.kind === "image" && <ImagePanel r={result.data} />}
      {result?.kind === "video" && <VideoPanel r={result.data} />}
    </>
  );
}

function Verdict({ alert }: { alert: boolean }) {
  return (
    <div className={`rounded-lg px-4 py-2 text-sm font-semibold ${alert ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"}`}>
      {alert ? "⚠ Hazard detected" : "✓ No fire or smoke detected"}
    </div>
  );
}

function ImagePanel({ r }: { r: ImageResult }) {
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
      <img src={r.annotated} alt="Annotated result" className="card w-full" />
      <div className="space-y-4">
        <Verdict alert={r.alert} />
        <StatCard label="Inference time" value={`${r.latency_ms} ms`} />
        <div className="card space-y-2 p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Detections ({r.detections.length})</div>
          {r.detections.length === 0 && <div className="text-sm text-slate-500">None</div>}
          {r.detections.map((d, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span className="font-medium capitalize" style={{ color: COLORS[d.label] }}>{d.label}</span>
              <span className="tabular-nums">{Math.round(d.confidence * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function VideoPanel({ r }: { r: VideoResult }) {
  return (
    <div className="mt-6 space-y-6">
      <Verdict alert={r.alert} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Duration" value={`${r.duration_s}s`} />
        <StatCard label="Frames analysed" value={r.frames_analysed} />
        <StatCard label="Fire frames" value={r.fire_frames} accent={COLORS.fire} />
        <StatCard label="Smoke frames" value={r.smoke_frames} accent={COLORS.smoke} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white"><FileVideo size={16} /> Confidence timeline</h2>
          <div className="h-60">
            <ResponsiveContainer>
              <LineChart data={r.timeline} margin={{ left: -20 }}>
                <CartesianGrid stroke="#222632" vertical={false} />
                <XAxis dataKey="time_s" unit="s" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 1]} tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "#171a22", border: "1px solid #2f3443", borderRadius: 8 }} />
                <Line type="monotone" dataKey="fire" stroke={COLORS.fire} dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="smoke" stroke={COLORS.smoke} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
        {r.peak_frame && (
          <section className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-white">Peak frame ({Math.round(r.peak_confidence * 100)}%)</h2>
            <img src={r.peak_frame} alt="Peak detection frame" className="w-full rounded-lg" />
          </section>
        )}
      </div>
    </div>
  );
}
