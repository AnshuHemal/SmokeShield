import { Camera, CameraOff, Lightbulb, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfidenceSlider, PageHeader } from "../components/ui";
import { api, COLORS, Detection, LABEL_COLOR } from "../lib/api";
import { beep } from "../lib/sound";

interface Reply {
  detections: Detection[]; // confirmed; `held` marks the last known box kept after a missed frame
  pending: Detection[]; // seen, not confirmed yet
  weak: Detection[]; // below the confidence threshold: never alarms
  latency_ms: number;
  alert: boolean;
  confirmed: string[];
  error?: string;
}

/** Detail = how many pixels the model gets. More pixels find smaller flames, at the cost of speed. */
const DETAIL = [
  { size: 640, label: "Standard", note: "fastest" },
  { size: 960, label: "High", note: "about 2× slower" },
  { size: 1280, label: "Maximum", note: "about 4× slower" },
] as const;

const PENDING = "#ffbe00";
const WEAK = "rgba(255,255,255,0.6)";

type Snapshot = { alert: boolean; confirmed: string[]; shown: Detection[]; pending: Detection[]; weak: Detection[] };
const EMPTY: Snapshot = { alert: false, confirmed: [], shown: [], pending: [], weak: [] };

export default function LiveMonitor({ ready }: { ready: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const grabRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const runningRef = useRef(false);
  const soundRef = useRef(true);
  const lastBeep = useRef(0);
  const wasAlert = useRef(false);
  const sizeRef = useRef<number>(960);
  const showWeakRef = useRef(true);

  const [running, setRunning] = useState(false);
  // Defaults suit a close-range test (lighter, match): lower threshold, more detail.
  const [conf, setConf] = useState(0.25);
  const [size, setSize] = useState<number>(960);
  const [showWeak, setShowWeak] = useState(true);
  const [sound, setSound] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState({ fps: 0, latency: 0 });
  const [snap, setSnap] = useState<Snapshot>(EMPTY);

  soundRef.current = sound;
  sizeRef.current = size;
  showWeakRef.current = showWeak;

  const draw = useCallback((r: Pick<Reply, "detections" | "pending" | "weak">) => {
    const canvas = overlayRef.current, video = videoRef.current;
    if (!canvas || !video) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const g = canvas.getContext("2d")!;
    g.clearRect(0, 0, canvas.width, canvas.height);
    const fontPx = Math.max(13, canvas.width / 50);
    g.font = `600 ${fontPx}px Inter, sans-serif`;

    const box = (d: Detection, color: string, text: string | null, opts: { dash?: number[]; width?: number; alpha?: number }) => {
      const [x1, y1, x2, y2] = [d.box[0] * canvas.width, d.box[1] * canvas.height, d.box[2] * canvas.width, d.box[3] * canvas.height];
      g.save();
      g.globalAlpha = opts.alpha ?? 1;
      g.lineWidth = opts.width ?? Math.max(2, canvas.width / 320);
      g.setLineDash(opts.dash ?? []);
      g.strokeStyle = g.fillStyle = color;
      g.strokeRect(x1, y1, x2 - x1, y2 - y1);
      if (text) {
        g.setLineDash([]);
        const w = g.measureText(text).width + 12, h = fontPx + 8;
        g.fillRect(x1, Math.max(0, y1 - h), w, h);
        g.fillStyle = "#0a0b0f";
        g.fillText(text, x1 + 6, Math.max(h - 6, y1 - 6));
      }
      g.restore();
    };

    // faintest first, so confirmed boxes end up on top
    if (showWeakRef.current) {
      [...r.weak].sort((a, b) => a.confidence - b.confidence).slice(-6).forEach((d) =>
        box(d, WEAK, null, { dash: [3, 5], width: 1.5, alpha: 0.85 }));
    }
    r.pending.forEach((d) => box(d, PENDING, `POSSIBLE ${d.label.toUpperCase()} ${Math.round(d.confidence * 100)}%`, { dash: [8, 6], width: 2 }));
    r.detections.forEach((d) =>
      d.held
        ? box(d, COLORS[d.label], null, { dash: [10, 7], alpha: 0.75 })
        : box(d, COLORS[d.label], `${d.label.toUpperCase()} ${Math.round(d.confidence * 100)}%`, {}));
  }, []);

  const stop = useCallback(() => {
    runningRef.current = false;
    wsRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    wsRef.current = null;
    streamRef.current = null;
    wasAlert.current = false;
    setRunning(false);
    setSnap(EMPTY);
    setInfo({ fps: 0, latency: 0 });
    overlayRef.current?.getContext("2d")?.clearRect(0, 0, 9999, 9999);
  }, []);

  useEffect(() => stop, [stop]);

  // push threshold / detail changes to the running stream without reconnecting
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ conf, imgsz: size }));
  }, [conf, size]);

  const sendFrame = useCallback(() => {
    const video = videoRef.current, ws = wsRef.current;
    if (!runningRef.current || !video || !ws || ws.readyState !== WebSocket.OPEN || !video.videoWidth) return;
    const c = grabRef.current;
    c.width = Math.min(sizeRef.current, video.videoWidth); // never upscale: it adds pixels, not information
    c.height = Math.round((c.width * video.videoHeight) / video.videoWidth);
    c.getContext("2d")!.drawImage(video, 0, 0, c.width, c.height);
    // 0.85: stronger compression smears a small flame
    c.toBlob((b) => b && ws.readyState === WebSocket.OPEN && ws.send(b), "image/jpeg", 0.85);
  }, []);

  const start = async () => {
    setError(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      streamRef.current = media;
      const video = videoRef.current!;
      video.srcObject = media;
      await video.play();

      const ws = new WebSocket(api.streamUrl(conf, size));
      wsRef.current = ws;
      runningRef.current = true;
      let frames = 0, t0 = performance.now();

      ws.onopen = () => { setRunning(true); sendFrame(); };
      ws.onmessage = (ev) => {
        const r: Reply = JSON.parse(ev.data);
        if (r.error) { setError("Model not loaded on the server."); stop(); return; }
        draw(r);
        setSnap({ alert: r.alert, confirmed: r.confirmed, shown: r.detections, pending: r.pending, weak: r.weak });
        // sound on the moment an alarm starts, not on every frame of it
        if (r.alert && !wasAlert.current && soundRef.current && Date.now() - lastBeep.current > 3000) { lastBeep.current = Date.now(); beep(); }
        wasAlert.current = r.alert;
        frames++;
        const now = performance.now();
        if (now - t0 > 1000) {
          setInfo({ fps: Math.round((frames * 1000) / (now - t0)), latency: r.latency_ms });
          frames = 0; t0 = now;
        }
        sendFrame(); // wait for the reply before sending the next frame
      };
      ws.onerror = () => setError("Stream connection failed.");
      ws.onclose = () => runningRef.current && stop();
    } catch (e) {
      stop();
      setError(e instanceof Error ? e.message : "Could not access the camera.");
    }
  };

  const topWeak = [...snap.weak].sort((a, b) => b.confidence - a.confidence)[0];
  const state: "alarm" | "verifying" | "weak" | "clear" = snap.alert ? "alarm" : snap.pending.length ? "verifying" : topWeak ? "weak" : "clear";

  return (
    <>
      <PageHeader
        title="Live Monitor"
        subtitle="Quick test using this browser's webcam. For permanent cameras, use Cameras."
        action={
          <div className="flex flex-wrap items-center gap-4">
            <ConfidenceSlider value={conf} onChange={setConf} />
            <label className="flex items-center gap-2 text-sm text-slate-400">
              Detail
              <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="input !w-auto" aria-label="Detail level">
                {DETAIL.map((d) => <option key={d.size} value={d.size}>{d.label} ({d.note})</option>)}
              </select>
            </label>
            <button onClick={() => setSound(!sound)} className="btn-ghost" aria-label="Toggle alarm sound">
              {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
            {running ? (
              <button onClick={stop} className="btn-ghost"><CameraOff size={16} /> Stop</button>
            ) : (
              <button onClick={start} disabled={!ready} className="btn-primary"><Camera size={16} /> Start camera</button>
            )}
          </div>
        }
      />
      {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className={`card relative overflow-hidden ${snap.alert ? "animate-pulseRing border-red-500" : ""}`}>
          <div className="relative aspect-video bg-black on-media">
            <video ref={videoRef} muted playsInline className="absolute inset-0 h-full w-full object-contain" />
            <canvas ref={overlayRef} className="absolute inset-0 h-full w-full object-contain" />
            {!running && (
              <div className="absolute inset-0 grid place-items-center text-sm text-slate-500">
                {ready ? "Camera is off" : "Waiting for the model…"}
              </div>
            )}
            {running && (
              <div className="absolute left-4 top-4" role="status" aria-live="polite">
                {state === "alarm" && <span className="rounded-md bg-red-600 px-3 py-1 text-sm font-bold tracking-wide text-white">⚠ HAZARD DETECTED</span>}
                {state === "verifying" && <span className="rounded-md bg-amber-500 px-3 py-1 text-sm font-bold text-slate-900">Verifying…</span>}
              </div>
            )}
          </div>
        </div>

        <aside className="card space-y-5 p-5">
          <h2 className="text-sm font-semibold text-heading">What the model sees</h2>

          <div className={`rounded-lg p-3 text-sm ${
            state === "alarm" ? "bg-red-500/15 text-red-300" : state === "verifying" ? "bg-amber-500/15 text-amber-300" : state === "weak" ? "bg-sky-500/15 text-sky-300" : "bg-ink-800 text-slate-400"}`}>
            {state === "alarm" && `Confirmed: ${snap.confirmed.join(" + ")}. This is being recorded as an incident.`}
            {state === "verifying" && "Something looks like a hazard. Waiting for a few more frames before raising the alarm."}
            {state === "weak" && `The model sees something at ${Math.round(topWeak.confidence * 100)}%, below your ${Math.round(conf * 100)}% threshold, so it is not an alarm. Lower the confidence to alarm on it.`}
            {state === "clear" && (running ? "Nothing detected." : "Start the camera to begin.")}
          </div>

          <List title="Confirmed" items={snap.shown} empty="None" />
          <List title="Verifying" items={snap.pending} empty="None" />
          <List title="Weak (below threshold)" items={[...snap.weak].sort((a, b) => b.confidence - a.confidence).slice(0, 4)} empty="None" muted />

          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-400">
            <input type="checkbox" checked={showWeak} onChange={(e) => setShowWeak(e.target.checked)} className="h-4 w-4 accent-orange-600" />
            Draw weak detections on the video
          </label>

          <div className="space-y-2 border-t border-ink-700 pt-4">
            <Row k="Status" v={running ? "Streaming" : "Idle"} />
            <Row k="Throughput" v={`${info.fps} fps`} />
            <Row k="Inference" v={`${info.latency} ms`} />
          </div>

          <div className="flex gap-2.5 rounded-lg bg-ink-800 p-3 text-xs leading-relaxed text-slate-400">
            <Lightbulb size={15} className="mt-0.5 shrink-0 text-amber-300" />
            <p>Small flames (lighter, match) are hard: keep the flame in focus, 30–50 cm from the lens, against a darker background, and use High detail. A lighter flame fills well under 1% of the picture.</p>
          </div>
        </aside>
      </div>
    </>
  );
}

function List({ title, items, empty, muted }: { title: string; items: Detection[]; empty: string; muted?: boolean }) {
  return (
    <div>
      <div className="mb-1.5 text-xs uppercase tracking-wide text-slate-500">{title}</div>
      {items.length === 0 ? (
        <div className="text-sm text-slate-500">{empty}</div>
      ) : (
        items.map((d, i) => (
          <div key={i} className="flex justify-between text-sm">
            <span className="capitalize" style={{ color: muted ? undefined : LABEL_COLOR[d.label] }}>{d.label}{d.held ? " (last seen)" : ""}</span>
            <span className="tabular-nums">{Math.round(d.confidence * 100)}%</span>
          </div>
        ))
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-500">{k}</span>
      <span className="tabular-nums text-slate-200">{v}</span>
    </div>
  );
}
