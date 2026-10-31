import { AnimatePresence, motion } from "framer-motion";
import { Activity, AlertTriangle, Bell, BellOff, Cpu, History, LayoutDashboard, LayoutGrid, ScanSearch, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Logo } from "./components/Logo";
import { PageTransition } from "./components/Motion";
import { ThemeToggle, ThemeToggleCompact } from "./components/ThemeToggle";
import { useToast } from "./components/Toast";
import { useEvents } from "./hooks/useEvents";
import { api, Health } from "./lib/api";
import { beep, setSoundEnabled, soundEnabled } from "./lib/sound";
import Analyze from "./pages/Analyze";
import Cameras from "./pages/Cameras";
import Dashboard from "./pages/Dashboard";
import Incidents from "./pages/Incidents";
import LiveMonitor from "./pages/LiveMonitor";
import Models from "./pages/Models";
import Monitor from "./pages/Monitor";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/monitor", label: "Monitor", icon: LayoutGrid },
  { to: "/cameras", label: "Cameras", icon: Video },
  { to: "/incidents", label: "Incidents", icon: History },
  { to: "/models", label: "Models", icon: Cpu },
  { to: "/live", label: "Browser Cam", icon: Activity },
  { to: "/analyze", label: "Analyze Media", icon: ScanSearch },
];

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { connected, onIncident } = useEvents();
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);
  const [sound, setSound] = useState(soundEnabled());

  useEffect(() => {
    const poll = () => api.health().then((h) => { setHealth(h); setOffline(false); }).catch(() => setOffline(true));
    poll();
    const t = setInterval(poll, 10000);
    window.addEventListener("smokeshield:model-changed", poll);
    return () => {
      clearInterval(t);
      window.removeEventListener("smokeshield:model-changed", poll);
    };
  }, []);

  // A confirmed hazard on any server-side camera pops a toast from anywhere in the app.
  useEffect(
    () =>
      onIncident(({ type, incident }) => {
        if (type !== "incident") return; // updates refresh the lists, they must not toast again
        toast({
          tone: "alert",
          title: `${incident.label === "fire" ? "🔥 Fire" : "💨 Smoke"} confirmed - ${incident.camera_name}`,
          description: `${Math.round(incident.confidence * 100)}% confidence`,
          action: { label: "Review", onClick: () => navigate(incident.camera_id != null ? `/incidents?camera=${incident.camera_id}` : "/incidents") },
        });
        if (soundEnabled()) beep();
      }),
    [onIncident, toast, navigate],
  );

  const toggleSound = () => {
    setSoundEnabled(!sound);
    setSound(!sound);
    if (!sound) beep(); // audible confirmation, and satisfies the browser's user-gesture rule
  };

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-ink-700 bg-ink-900 md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:flex-col md:border-r">
        <div className="flex items-center gap-3 px-5 py-5">
          <Logo size={40} />
          <div>
            <div className="text-lg font-semibold leading-tight text-heading">SmokeShield</div>
            <div className="text-xs text-slate-500">See the flames before they spread</div>
          </div>
          <div className="ml-auto md:hidden"><ThemeToggleCompact /></div>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `relative flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${isActive ? "text-ember-400" : "text-slate-400 hover:bg-ink-800 hover:text-slate-200"}`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-ember-500/15" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                  <Icon size={18} className="relative" />
                  <span className="relative">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto hidden space-y-3 p-4 text-xs md:block">
          <div className="card space-y-1 p-3">
            <div className="flex items-center gap-2 font-medium text-slate-300">
              <span className={`h-2 w-2 rounded-full ${offline ? "bg-red-500" : health?.model_loaded ? "bg-emerald-400" : "bg-amber-400"}`} />
              {offline ? "API offline" : health?.model_loaded ? "Model ready" : "Model missing"}
            </div>
            <div className="truncate text-slate-400" title={health?.model_name ?? undefined}>
              {health?.model_loaded ? health.model_name ?? "Active model" : "Add or activate a model"}
            </div>
            <div className="text-slate-500">
              {health?.model_loaded ? `${health.classes.join(", ")} · ${health.device}` : "See the Models page"}
            </div>
            <div className="flex items-center gap-2 pt-1 text-slate-500">
              <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-slate-600"}`} />
              {connected ? "Live updates connected" : "Live updates offline"}
            </div>
          </div>
          <button onClick={toggleSound} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-slate-400 hover:bg-ink-800 hover:text-slate-200">
            {sound ? <Bell size={15} /> : <BellOff size={15} />} Alarm sound {sound ? "on" : "off"}
          </button>
          <ThemeToggle />
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 md:p-8">
        {offline && <Banner text="Cannot reach the backend. Start it with: uvicorn app.main:app --port 8000" />}
        {!offline && health && !health.model_loaded && (
          <Banner text={`No model is live. Open Models to upload or activate one (weights are normally at ${health.model_path}).`} />
        )}
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<PageTransition><Dashboard /></PageTransition>} />
            <Route path="/monitor" element={<PageTransition><Monitor /></PageTransition>} />
            <Route path="/cameras" element={<PageTransition><Cameras /></PageTransition>} />
            <Route path="/incidents" element={<PageTransition><Incidents /></PageTransition>} />
            <Route path="/models" element={<PageTransition><Models /></PageTransition>} />
            <Route path="/live" element={<PageTransition><LiveMonitor ready={!!health?.model_loaded} /></PageTransition>} />
            <Route path="/analyze" element={<PageTransition><Analyze ready={!!health?.model_loaded} /></PageTransition>} />
          </Routes>
        </AnimatePresence>
      </main>
    </div>
  );
}

function Banner({ text }: { text: string }) {
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" /> {text}
    </div>
  );
}
