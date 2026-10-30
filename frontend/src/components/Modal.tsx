import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { ReactNode, useEffect } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Tailwind max-width class for the panel */
  width?: string;
}

/** Accessible dialog: Esc and backdrop click close it, body scroll is locked while open. */
export function Modal({ open, onClose, title, children, width = "max-w-2xl" }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={`card w-full ${width} my-6 shadow-2xl shadow-black/50`}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          >
            {title && (
              <div className="flex items-center justify-between border-b border-ink-700 px-6 py-4">
                <h2 className="text-lg font-semibold text-heading">{title}</h2>
                <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-slate-500 hover:bg-ink-700 hover:text-slate-200">
                  <X size={18} />
                </button>
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  /** "danger" (red, default) for deletes; "primary" (brand orange) for safe actions such as switching models */
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel = "Delete", tone = "danger", onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title} width="max-w-md">
      <div className="p-6">
        <div className="text-sm text-slate-400">{message}</div>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onCancel} className="btn-ghost">Cancel</button>
          <button onClick={onConfirm} className={tone === "danger" ? "btn bg-red-600 text-white hover:bg-red-700" : "btn-primary"}>{confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}
