import { Activity, AlertTriangle, History, LayoutDashboard, ScanSearch, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { api, Health } from "./lib/api";
import Analyze from "./pages/Analyze";
import Dashboard from "./pages/Dashboard";
import Incidents from "./pages/Incidents";
import LiveMonitor from "./pages/LiveMonitor";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/live", label: "Live Monitor", icon: Activity },
  { to: "/analyze", label: "Analyze Media", icon: ScanSearch },
  { to: "/incidents", label: "Incidents", icon: History },
];

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const poll = () =>
      api.health().then((h) => { setHealth(h); setOffline(false); }).catch(() => setOffline(true));
    poll();
    const t = setInterval(poll, 10000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-ink-700 bg-ink-900 md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:border-r">
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-ember-500/15 text-ember-400">
            <ShieldAlert size={22} />
          </div>
          <div>
            <div className="text-lg font-semibold leading-tight text-white">SmokeShield</div>
            <div className="text-xs text-slate-500">Fire &amp; smoke detection</div>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? "bg-ember-500/15 text-ember-400" : "text-slate-400 hover:bg-ink-800 hover:text-slate-200"
                }`
              }
            >
              <Icon size={18} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden px-5 pt-6 text-xs md:block">
          <div className="card space-y-1 p-3">
            <div className="flex items-center gap-2 font-medium text-slate-300">
              <span className={`h-2 w-2 rounded-full ${offline ? "bg-red-500" : health?.model_loaded ? "bg-emerald-400" : "bg-amber-400"}`} />
              {offline ? "API offline" : health?.model_loaded ? "Model ready" : "Model missing"}
            </div>
            <div className="text-slate-500">
              {health?.model_loaded ? `${health.classes.join(", ")} · ${health.device}` : "Add models/best.pt"}
            </div>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 md:p-8">
        {offline && <Banner text="Cannot reach the backend. Start it with: uvicorn app.main:app --port 8000" />}
        {!offline && health && !health.model_loaded && (
          <Banner text={`No YOLO weights at ${health.model_path}. Train one with backend/train.py and restart the API.`} />
        )}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/live" element={<LiveMonitor ready={!!health?.model_loaded} />} />
          <Route path="/analyze" element={<Analyze ready={!!health?.model_loaded} />} />
          <Route path="/incidents" element={<Incidents />} />
        </Routes>
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
