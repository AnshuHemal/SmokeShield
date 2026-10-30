import { motion } from "framer-motion";
import { ShieldCheck, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { staggerContainer, staggerItem } from "../components/Motion";
import { Skeleton } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";
import { Empty, LabelBadge, PageHeader, ReviewBadge } from "../components/ui";
import { useCameras } from "../hooks/useCameras";
import { useEvents } from "../hooks/useEvents";
import { api, COLORS, Incident, Stats, timeAgo } from "../lib/api";

function Metric({ label, children, hint, accent }: { label: string; children: React.ReactNode; hint?: string; accent?: string }) {
  return (
    <motion.div variants={staggerItem} className="card p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-white" style={accent ? { color: accent } : undefined}>{children}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </motion.div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Incident[] | null>(null);
  const { cameras } = useCameras();
  const { states, onIncident } = useEvents();
  const navigate = useNavigate();

  const load = useCallback(() => {
    api.stats().then(setStats).catch(() => {});
    api.incidents({ limit: 6 }).then(setRecent).catch(() => setRecent([]));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => onIncident(load), [onIncident, load]);

  const hourly = (stats?.hourly ?? []).map((h) => ({
    ...h,
    hour: new Date(h.start).toLocaleTimeString([], { hour: "numeric" }),
  }));

  const online = Object.values(states).filter((s) => ["ok", "smoke", "fire"].includes(s.status)).length;
  const total = cameras?.length ?? stats?.cameras_total ?? 0;
  const far = stats?.false_alarm_rate;

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Overview of detections across cameras, live feeds and uploaded media." />

      {!stats ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : (
        <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <Metric label="Total incidents"><AnimatedNumber value={stats.total} /></Metric>
          <Metric label="Fire" accent={COLORS.fire}><AnimatedNumber value={stats.fire} /></Metric>
          <Metric label="Smoke" accent={COLORS.smoke}><AnimatedNumber value={stats.smoke} /></Metric>
          <Metric label="Cameras online" hint={total ? `${total - online} offline or paused` : "None added yet"}>
            <AnimatedNumber value={online} /><span className="text-xl text-slate-500"> / {total}</span>
          </Metric>
          <Metric label="False alarm rate" hint={far == null ? "Review incidents to measure" : `${stats.reviewed} reviewed`} accent={far != null && far > 0.3 ? "#fbbf24" : undefined}>
            {far == null ? "–" : <AnimatedNumber value={far * 100} format={(n) => `${Math.round(n)}%`} />}
          </Metric>
          <Metric label="Avg confidence" hint={`${stats.last_24h} in last 24h`}>
            <AnimatedNumber value={stats.avg_confidence * 100} format={(n) => `${Math.round(n)}%`} />
          </Metric>
        </motion.div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <section className="card p-5 xl:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-white">Incidents - last 24 hours</h2>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={hourly} margin={{ left: -20 }}>
                <CartesianGrid stroke="#222632" vertical={false} />
                <XAxis dataKey="hour" tick={{ fill: "#64748b", fontSize: 11 }} interval={2} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "#171a22", border: "1px solid #2f3443", borderRadius: 8 }} cursor={{ fill: "#ffffff08" }} />
                <Bar dataKey="fire" stackId="a" fill={COLORS.fire} />
                <Bar dataKey="smoke" stackId="a" fill={COLORS.smoke} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Cameras</h2>
            <Link to="/monitor" className="text-xs text-ember-400 hover:text-ember-500">Open monitor →</Link>
          </div>
          {cameras && cameras.length === 0 ? (
            <Empty icon={<Video size={30} />} text="No cameras added" action={<Link to="/cameras" className="btn-ghost">Add a camera</Link>} />
          ) : (
            <ul className="space-y-2.5">
              {(cameras ?? []).slice(0, 6).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm text-slate-300">{c.name}</span>
                  <StatusPill status={states[c.id]?.status ?? (c.enabled ? "starting" : "disabled")} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card mt-6 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Recent incidents</h2>
          <Link to="/incidents" className="text-xs text-ember-400 hover:text-ember-500">View all →</Link>
        </div>
        {recent === null ? (
          <Skeleton className="h-20" />
        ) : recent.length === 0 ? (
          <Empty icon={<ShieldCheck size={32} />} text="All clear - no incidents yet" />
        ) : (
          <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="grid gap-x-8 gap-y-3 md:grid-cols-2">
            {recent.map((i) => (
              <motion.li key={i.id} variants={staggerItem}>
                <button onClick={() => navigate(`/incidents${i.camera_id ? `?camera=${i.camera_id}` : ""}`)} className="flex w-full items-center gap-3 rounded-lg p-1.5 text-left transition hover:bg-ink-800">
                  {i.snapshot_url ? <img src={i.snapshot_url} alt="" className="h-12 w-16 rounded-md object-cover" /> : <div className="h-12 w-16 rounded-md bg-ink-700" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><LabelBadge label={i.label} /><ReviewBadge status={i.status} /></div>
                    <div className="mt-1 truncate text-xs text-slate-500">{i.camera_name ?? i.source} · {timeAgo(i.created_at)}</div>
                  </div>
                  <div className="text-sm tabular-nums text-slate-300">{Math.round(i.confidence * 100)}%</div>
                </button>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </section>
    </>
  );
}
