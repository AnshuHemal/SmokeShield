import { useEffect, useState } from "react";

/**
 * Polls a camera's latest annotated frame. Short requests (instead of a long-lived MJPEG connection)
 * avoid the browser's 6-connections-per-host limit, so a wall of cameras never blocks the API.
 * Each frame is preloaded before it replaces the previous one, so the picture never flickers.
 */
export function useFramePoll(cameraId: number, active: boolean, intervalMs = 350): string | null {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    let timer: number;

    const tick = () => {
      if (cancelled) return;
      if (document.hidden) {
        timer = window.setTimeout(tick, 1000); // pause while the tab is in the background
        return;
      }
      const started = performance.now();
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        setSrc(img.src);
        timer = window.setTimeout(tick, Math.max(0, intervalMs - (performance.now() - started)));
      };
      img.onerror = () => {
        timer = window.setTimeout(tick, 1000); // 204 (no frame yet) or a network blip
      };
      img.src = `/api/cameras/${cameraId}/frame?t=${Date.now()}`;
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cameraId, active, intervalMs]);

  return active ? src : null;
}
