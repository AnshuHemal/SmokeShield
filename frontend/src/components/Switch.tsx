import { motion } from "framer-motion";

interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-50 ${checked ? "justify-end bg-ember-500" : "justify-start bg-ink-600"}`}
    >
      <motion.span layout transition={{ type: "spring", stiffness: 500, damping: 32 }} className="h-5 w-5 rounded-full bg-white shadow" />
    </button>
  );
}
