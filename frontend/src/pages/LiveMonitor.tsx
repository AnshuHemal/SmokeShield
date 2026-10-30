import { Camera, CameraOff, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfidenceSlider, PageHeader } from "../components/ui";
import { api, COLORS, Detection } from "../lib/api";

interface Reply {
  detections: Detection[];
  latency_ms: number;
  alert: boolean;
  error?: string;
}

const SEND_WIDTH = 640;

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 880;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    osc.onended = () => ctx.close();
  } catch {
    /* audio unavailable */
  }
}

export default function LiveMonitor({ ready }: { ready: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const grabRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const runningRef = useRef(false);
  const soundRef = useRef(true);
  const lastBeep = useRef(0);

  const [running, setRunning] = useState(false);
  const [conf, setConf] = useState(0.4);
  const [sound, setSound] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ fps: number; latency: number; dets: Detection[] }>({ fps: 0, latency: 0, dets: [] });
  const [alert, setAlert] = useState(false);

  soundRef.current = sound;

  const draw = useCallback((dets: Detection[]) => {
    const canvas = overlayRef.current, video = videoRef.current;
    if (!canvas || !video) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const g = canvas.getContext("2d")!;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.lineWidth = Math.max(2, canvas.width / 320);
    g.font = `600 ${Math.max(13, canvas.width / 50)}px Inter, sans-serif`;
    for (const d of dets) {
      const [x1, y1, x2, y2] = [d.box[0] * canvas.width, d.box[1] * canvas.height, d.box[2] * canvas.width, d.box[3] * canvas.height];
      g.strokeStyle = g.fillStyle = COLORS[d.label];
      g.strokeRect(x1, y1, x2 - x1, y2 - y1);
      const text = `${d.label.toUpperCase()} ${Math.round(d.confidence * 100)}%`;
      const w = g.measureText(text).width + 12, h = parseInt(g.font.split("px")[0].split(" ").pop()!) + 8;
      g.fillRect(x1, Math.max(0, y1 - h), w, h);
      g.fillStyle = "#0a0b0f";
      g.fillText(text, x1 + 6, Math.max(h - 6, y1 - 6));
    }
  }, []);

  const stop = useCallback(() => {
    runningRef.current = false;
    wsRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    wsRef.current = null;
    streamRef.current = null;
    setRunning(false);
    setAlert(false);
    setInfo({ fps: 0, latency: 0, dets: [] });
    overlayRef.current?.getContext("2d")?.clearRect(0, 0, 9999, 9999);
  }, []);

  useEffect(() => stop, [stop]);

  // push threshold changes to the running stream without reconnecting
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ conf }));
  }, [conf]);

  const sendFrame = useCallback(() => {
    const video = videoRef.current, ws = wsRef.current;
    if (!runningRef.current || !video || !ws || ws.readyState !== WebSocket.OPEN || !video.videoWidth) return;
    const c = grabRef.current;
    c.width = SEND_WIDTH;
    c.height = Math.round((SEND_WIDTH * video.videoHeight) / video.videoWidth);
    c.getContext("2d")!.drawImage(video, 0, 0, c.width, c.height);
    c.toBlob((b) => b && ws.readyState === WebSocket.OPEN && ws.send(b), "image/jpeg", 0.7);
  }, []);

  const start = async () => {
    setError(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
      streamRef.current = media;
      const video = videoRef.current!;
      video.srcObject = media;
      await video.play();

      const ws = new WebSocket(api.streamUrl(conf));
      wsRef.current = ws;
      runningRef.current = true;
      let frames = 0, t0 = performance.now();

      ws.onopen = () => { setRunning(true); sendFrame(); };
      ws.onmessage = (ev) => {
        const r: Reply = JSON.parse(ev.data);
        if (r.error) { setError("Model not loaded on the server."); stop(); return; }
        draw(r.detections);
        setAlert(r.alert);
        if (r.alert && soundRef.current && Date.now() - lastBeep.current > 3000) { lastBeep.current = Date.now(); beep(); }
        frames++;
        const now = performance.now();
        if (now - t0 > 1000) {
          setInfo({ fps: Math.round((frames * 1000) / (now - t0)), latency: r.latency_ms, dets: r.detections });
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

  return (
    <>
      <PageHeader
        title="Live Monitor"
        subtitle="Real-time detection from your webcam over a WebSocket stream."
        action={
          <div className="flex flex-wrap items-center gap-4">
            <ConfidenceSlider value={conf} onChange={setConf} />
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

      <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <div className={`card relative overflow-hidden ${alert ? "animate-pulseRing border-red-500" : ""}`}>
          <div className="relative aspect-video bg-black">
            <video ref={videoRef} muted playsInline className="absolute inset-0 h-full w-full object-contain" />
            <canvas ref={overlayRef} className="absolute inset-0 h-full w-full object-contain" />
            {!running && (
              <div className="absolute inset-0 grid place-items-center text-sm text-slate-500">
                {ready ? "Camera is off" : "Waiting for the model…"}
              </div>
            )}
            {alert && (
              <div className="absolute left-4 top-4 rounded-md bg-red-600 px-3 py-1 text-sm font-bold tracking-wide text-white">
                ⚠ HAZARD DETECTED
              </div>
            )}
          </div>
        </div>

        <aside className="card space-y-4 p-5">
          <h2 className="text-sm font-semibold text-white">Stream stats</h2>
          <Row k="Status" v={running ? "Streaming" : "Idle"} />
          <Row k="Throughput" v={`${info.fps} fps`} />
          <Row k="Inference" v={`${info.latency} ms`} />
          <div>
            <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Current detections</div>
            {info.dets.length === 0 ? (
              <div className="text-sm text-slate-500">Nothing detected</div>
            ) : (
              info.dets.map((d, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="capitalize" style={{ color: COLORS[d.label] }}>{d.label}</span>
                  <span className="tabular-nums">{Math.round(d.confidence * 100)}%</span>
                </div>
              ))
            )}
          </div>
          <p className="text-xs text-slate-500">New hazards are logged to Incidents automatically (with a cool-down to avoid duplicates).</p>
        </aside>
      </div>
    </>
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
