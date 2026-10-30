import { ModelVersion } from "../../lib/api";

export type MetricKey = "map50" | "map50_95" | "precision" | "recall";

export const METRICS: { key: MetricKey; label: string }[] = [
  { key: "map50", label: "mAP50" },
  { key: "map50_95", label: "mAP50-95" },
  { key: "precision", label: "Precision" },
  { key: "recall", label: "Recall" },
];

export const pct = (v: number | null, digits = 1) => (v == null ? "—" : `${(v * 100).toFixed(digits)}%`);

/** Difference in percentage points of `model` versus the live model, or null if either is unknown. */
export function deltaVs(model: ModelVersion, live: ModelVersion | null, key: MetricKey): number | null {
  if (!live || live.id === model.id || model[key] == null || live[key] == null) return null;
  return (model[key] as number) - (live[key] as number);
}

/** "2.8× slower" / "1.9× faster" relative to the live model, or null when not comparable. */
export function speedVs(model: ModelVersion, live: ModelVersion | null): { text: string; slower: boolean } | null {
  if (!live || live.id === model.id || !model.latency_ms || !live.latency_ms) return null;
  const ratio = model.latency_ms / live.latency_ms;
  if (ratio > 0.9 && ratio < 1.1) return { text: "about the same speed", slower: false };
  return ratio > 1 ? { text: `${ratio.toFixed(1)}× slower`, slower: true } : { text: `${(1 / ratio).toFixed(1)}× faster`, slower: false };
}

export const hasMetrics = (m: ModelVersion) => METRICS.some(({ key }) => m[key] != null);
