export type Label = "fire" | "smoke";
export type ReviewStatus = "new" | "real" | "false_alarm";
export type SourceType = "stream" | "file" | "device";
export type CameraStatus = "starting" | "ok" | "smoke" | "fire" | "offline" | "disabled";

export interface Detection {
  label: Label;
  confidence: number;
  box: [number, number, number, number]; // normalised x1,y1,x2,y2
}

export interface Health {
  status: "ok" | "model_missing";
  model_loaded: boolean;
  model_path: string;
  classes: string[];
  device: string;
  cameras_total: number;
  cameras_online: number;
}

export interface ImageResult {
  detections: Detection[];
  latency_ms: number;
  alert: boolean;
  annotated: string;
  incident_id: number | null;
}

export interface VideoResult {
  frames_analysed: number;
  duration_s: number;
  fire_frames: number;
  smoke_frames: number;
  peak_confidence: number;
  alert: boolean;
  timeline: { time_s: number; fire: number; smoke: number }[];
  peak_frame: string | null;
  incident_id: number | null;
}

export type Point = [number, number];

export interface CameraInput {
  name: string;
  source_type: SourceType;
  source: string;
  enabled: boolean;
  confidence: number;
  confirm_frames: number;
  confirm_window: number;
  cooldown: number;
  zone: Point[] | null;
}

export interface Camera extends CameraInput {
  id: number;
  created_at: string;
}

export interface CameraState {
  id: number;
  status: CameraStatus;
  fps: number;
  latency_ms: number;
  detections: Detection[];
  last_frame_at: number | null;
  error: string | null;
}

export interface Incident {
  id: number;
  created_at: string;
  label: Label;
  confidence: number;
  source: "live" | "image" | "video" | "camera";
  status: ReviewStatus;
  reviewed_at: string | null;
  camera_id: number | null;
  camera_name: string | null;
  snapshot_url: string | null;
  raw_url: string | null;
  detections: Detection[];
}

export interface IncidentQuery {
  limit?: number;
  offset?: number;
  label?: Label;
  status?: ReviewStatus;
  camera_id?: number;
}

export interface Stats {
  total: number;
  fire: number;
  smoke: number;
  last_24h: number;
  avg_confidence: number;
  hourly: { start: string; fire: number; smoke: number }[];
  reviewed: number;
  real: number;
  false_alarms: number;
  false_alarm_rate: number | null;
  cameras_total: number;
  cameras_online: number;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.status === 204 ? (undefined as T) : res.json();
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) return body.detail.map((d: { loc?: string[]; msg: string }) => `${d.loc?.slice(1).join(".") ?? ""}: ${d.msg}`).join("; ");
  } catch {
    /* non-JSON error body */
  }
  return res.statusText || `Request failed (${res.status})`;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function upload<T>(path: string, file: File, conf: number) {
  const body = new FormData();
  body.append("file", file);
  return request<T>(`${path}?conf=${conf}`, { method: "POST", body });
}

function queryString(q: IncidentQuery) {
  const p = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => v !== undefined && p.set(k, String(v)));
  return p.toString();
}

export const api = {
  health: () => request<Health>("/api/health"),
  stats: () => request<Stats>("/api/stats"),

  // incidents
  incidents: (q: IncidentQuery = {}) => request<Incident[]>(`/api/incidents?${queryString({ limit: 48, ...q })}`),
  reviewIncident: (id: number, status: ReviewStatus) =>
    request<Incident>(`/api/incidents/${id}/review`, json("PATCH", { status })),
  deleteIncident: (id: number) => request<void>(`/api/incidents/${id}`, { method: "DELETE" }),
  trainingExportUrl: "/api/incidents/export/training",

  // cameras
  cameras: () => request<Camera[]>("/api/cameras"),
  cameraStates: () => request<CameraState[]>("/api/cameras/status"),
  createCamera: (c: CameraInput) => request<Camera>("/api/cameras", json("POST", c)),
  updateCamera: (id: number, c: Partial<CameraInput>) => request<Camera>(`/api/cameras/${id}`, json("PATCH", c)),
  deleteCamera: (id: number) => request<void>(`/api/cameras/${id}`, { method: "DELETE" }),
  async previewFrame(source_type: SourceType, source: string): Promise<string> {
    const res = await fetch("/api/cameras/preview", json("POST", { source_type, source }));
    if (!res.ok) throw new Error(await errorMessage(res));
    return URL.createObjectURL(await res.blob());
  },
  async snapshot(id: number): Promise<string> {
    const res = await fetch(`/api/cameras/${id}/snapshot?t=${Date.now()}`);
    if (!res.ok) throw new Error(await errorMessage(res));
    return URL.createObjectURL(await res.blob());
  },
  /** XHR instead of fetch so the UI can show upload progress. */
  uploadVideo(file: File, onProgress: (pct: number) => void): Promise<{ filename: string; size_mb: number }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/cameras/upload-video");
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve(JSON.parse(xhr.responseText));
        try {
          reject(new Error(JSON.parse(xhr.responseText).detail ?? "Upload failed"));
        } catch {
          reject(new Error("Upload failed"));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      const body = new FormData();
      body.append("file", file);
      xhr.send(body);
    });
  },

  // one-off analysis + browser webcam
  detectImage: (file: File, conf: number) => upload<ImageResult>("/api/detect/image", file, conf),
  detectVideo: (file: File, conf: number) => upload<VideoResult>("/api/detect/video", file, conf),
  streamUrl: (conf: number) => wsUrl(`/ws/stream?conf=${conf}`),
  eventsUrl: () => wsUrl("/ws/events"),
};

function wsUrl(path: string) {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${path}`;
}

export const COLORS: Record<Label, string> = { fire: "#ff5a36", smoke: "#94a3b8" };

export const timeAgo = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
