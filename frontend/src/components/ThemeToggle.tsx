import { AnimatePresence, motion } from "framer-motion";
import { Monitor, Moon, Sun } from "lucide-react";
import { ThemePreference, useTheme } from "../hooks/useTheme";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
];

/** Full segmented control (Light / System / Dark) with a sliding highlight. */
export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  return (
    <div role="radiogroup" aria-label="Colour theme" className="flex rounded-lg border border-ink-700 bg-ink-800 p-1">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            aria-label={`${label} theme`}
            title={`${label} theme`}
            onClick={() => setPreference(value)}
            className={`relative flex flex-1 items-center justify-center rounded-md py-1.5 transition-colors ${active ? "text-heading" : "text-slate-500 hover:text-slate-300"}`}
          >
            {active && (
              <motion.span
                layoutId="theme-active"
                className="absolute inset-0 rounded-md border border-ink-600 bg-ink-900 shadow-card"
                transition={{ type: "spring", stiffness: 480, damping: 36 }}
              />
            )}
            <Icon size={15} className="relative" />
          </button>
        );
      })}
    </div>
  );
}

/** Single icon button that cycles light → dark → system; used where space is tight (mobile header). */
export function ThemeToggleCompact() {
  const { preference, resolved, cycle } = useTheme();
  const Icon = preference === "system" ? Monitor : resolved === "dark" ? Moon : Sun;
  const next = preference === "light" ? "dark" : preference === "dark" ? "system" : "light";
  return (
    <button
      onClick={cycle}
      aria-label={`Theme: ${preference}. Switch to ${next}`}
      title={`Theme: ${preference}`}
      className="grid h-9 w-9 place-items-center rounded-lg border border-ink-700 bg-ink-800 text-slate-300 hover:text-heading"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={preference}
          initial={{ rotate: -80, opacity: 0, scale: 0.6 }}
          animate={{ rotate: 0, opacity: 1, scale: 1 }}
          exit={{ rotate: 80, opacity: 0, scale: 0.6 }}
          transition={{ duration: 0.16 }}
          className="grid place-items-center"
        >
          <Icon size={17} />
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
