export type Label = "fire" | "smoke";

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

export interface Incident {
  id: number;
  created_at: string;
  label: Label;
  confidence: number;
  source: "live" | "image" | "video";
  snapshot_url: string | null;
}

export interface Stats {
  total: number;
  fire: number;
  smoke: number;
  last_24h: number;
  avg_confidence: number;
  hourly: { start: string; fire: number; smoke: number }[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

function upload<T>(path: string, file: File, conf: number) {
  const body = new FormData();
  body.append("file", file);
  return request<T>(`${path}?conf=${conf}`, { method: "POST", body });
}

export const api = {
  health: () => request<Health>("/api/health"),
  stats: () => request<Stats>("/api/stats"),
  incidents: (limit = 100, label?: Label) =>
    request<Incident[]>(`/api/incidents?limit=${limit}${label ? `&label=${label}` : ""}`),
  deleteIncident: (id: number) => request<void>(`/api/incidents/${id}`, { method: "DELETE" }),
  detectImage: (file: File, conf: number) => upload<ImageResult>("/api/detect/image", file, conf),
  detectVideo: (file: File, conf: number) => upload<VideoResult>("/api/detect/video", file, conf),
  streamUrl: (conf: number) =>
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/stream?conf=${conf}`,
};

export const COLORS: Record<Label, string> = { fire: "#ff5a36", smoke: "#94a3b8" };

export const timeAgo = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso + "Z").getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
