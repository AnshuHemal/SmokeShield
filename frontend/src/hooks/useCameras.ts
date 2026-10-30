import { useCallback, useEffect, useState } from "react";
import { api, Camera } from "../lib/api";

/** Camera configuration list (live state comes separately from useEvents). */
export function useCameras() {
  const [cameras, setCameras] = useState<Camera[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setCameras(await api.cameras());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load cameras");
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { cameras, error, reload };
}
