import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Flame, Info, X } from "lucide-react";
import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";

type Tone = "success" | "error" | "info" | "alert";
interface ToastItem {
  id: number;
  tone: Tone;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

const ToastContext = createContext<{ toast: (t: Omit<ToastItem, "id"> & { duration?: number }) => void } | null>(null);

const STYLE: Record<Tone, { icon: ReactNode; ring: string }> = {
  success: { icon: <CheckCircle2 size={18} className="text-emerald-400" />, ring: "border-emerald-500/30" },
  error: { icon: <AlertTriangle size={18} className="text-red-400" />, ring: "border-red-500/30" },
  info: { icon: <Info size={18} className="text-sky-400" />, ring: "border-sky-500/30" },
  alert: { icon: <Flame size={18} className="text-ember-400" />, ring: "border-red-500/60 shadow-[0_0_24px_-6px_rgba(239,68,68,.6)]" },
};

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => setItems((x) => x.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    ({ duration, ...t }: Omit<ToastItem, "id"> & { duration?: number }) => {
      const id = nextId++;
      setItems((x) => [...x.slice(-3), { ...t, id }]); // keep at most 4 on screen
      setTimeout(() => dismiss(id), duration ?? (t.tone === "alert" ? 10000 : 5000));
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* top-right: dialogs keep their action buttons bottom-right, so toasts must never cover them */}
      <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 60, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 400, damping: 32 }}
              className={`pointer-events-auto flex items-start gap-3 rounded-xl border bg-ink-800/95 p-4 backdrop-blur ${STYLE[t.tone].ring}`}
              role={t.tone === "error" || t.tone === "alert" ? "alert" : "status"}
            >
              <div className="mt-0.5">{STYLE[t.tone].icon}</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-heading">{t.title}</div>
                {t.description && <div className="mt-0.5 text-sm text-slate-400">{t.description}</div>}
                {t.action && (
                  <button
                    onClick={() => { t.action!.onClick(); dismiss(t.id); }}
                    className="mt-2 text-sm font-medium text-ember-400 hover:text-ember-500"
                  >
                    {t.action.label} →
                  </button>
                )}
              </div>
              <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-slate-500 hover:text-slate-300">
                <X size={16} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx.toast;
}
