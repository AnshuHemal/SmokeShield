import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ModelVersion } from "../lib/api";

/** Registered model versions, plus the derived "who is live" and "what would roll back to". */
export function useModels() {
  const [models, setModels] = useState<ModelVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setModels(await api.models());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load models");
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const active = useMemo(() => models?.find((m) => m.is_active) ?? null, [models]);

  // Mirrors the server rule: the most recently live version that is not live now and still has its file.
  const previous = useMemo(
    () =>
      (models ?? [])
        .filter((m) => !m.is_active && m.deactivated_at && m.file_exists)
        .sort((a, b) => (b.deactivated_at ?? "").localeCompare(a.deactivated_at ?? ""))[0] ?? null,
    [models],
  );

  return { models, active, previous, error, reload };
}

/** Tells the app shell (sidebar) that the live model changed so it refreshes immediately. */
export const announceModelChange = () => window.dispatchEvent(new Event("smokeshield:model-changed"));
