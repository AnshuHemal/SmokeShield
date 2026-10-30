import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Empty, LabelBadge, PageHeader, StatCard } from "../components/ui";
import { api, COLORS, Incident, Stats, timeAgo } from "../lib/api";

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Incident[]>([]);

  useEffect(() => {
    const load = () => {
      api.stats().then(setStats).catch(() => {});
      api.incidents(6).then(setRecent).catch(() => {});
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const hourly = (stats?.hourly ?? []).map((h) => ({
    ...h,
    hour: new Date(h.start).toLocaleTimeString([], { hour: "numeric" }),
  }));

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Overview of detections across live feeds and uploaded media." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total incidents" value={stats?.total ?? "–"} />
        <StatCard label="Fire" value={stats?.fire ?? "–"} accent={COLORS.fire} />
        <StatCard label="Smoke" value={stats?.smoke ?? "–"} accent={COLORS.smoke} />
        <StatCard label="Avg confidence" value={stats ? `${Math.round(stats.avg_confidence * 100)}%` : "–"} hint={`${stats?.last_24h ?? 0} in last 24h`} />
      </div>

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
                <Bar dataKey="fire" stackId="a" fill={COLORS.fire} radius={[0, 0, 0, 0]} />
                <Bar dataKey="smoke" stackId="a" fill={COLORS.smoke} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-4 text-sm font-semibold text-white">Recent incidents</h2>
          {recent.length === 0 ? (
            <Empty icon={<ShieldCheck size={32} />} text="All clear - no incidents yet" />
          ) : (
            <ul className="space-y-3">
              {recent.map((i) => (
                <li key={i.id} className="flex items-center gap-3">
                  {i.snapshot_url ? (
                    <img src={i.snapshot_url} alt="" className="h-12 w-16 rounded-md object-cover" />
                  ) : (
                    <div className="h-12 w-16 rounded-md bg-ink-700" />
                  )}
                  <div className="min-w-0 flex-1">
                    <LabelBadge label={i.label} />
                    <div className="mt-1 text-xs text-slate-500">{i.source} · {timeAgo(i.created_at)}</div>
                  </div>
                  <div className="text-sm tabular-nums text-slate-300">{Math.round(i.confidence * 100)}%</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
