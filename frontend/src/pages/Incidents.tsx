import { Download, History, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Empty, LabelBadge, PageHeader } from "../components/ui";
import { api, Incident, Label } from "../lib/api";

export default function Incidents() {
  const [items, setItems] = useState<Incident[]>([]);
  const [filter, setFilter] = useState<Label | undefined>();
  const [preview, setPreview] = useState<Incident | null>(null);

  const load = useCallback(() => api.incidents(200, filter).then(setItems).catch(() => {}), [filter]);
  useEffect(() => { load(); }, [load]);

  const remove = async (id: number) => {
    await api.deleteIncident(id);
    setItems((x) => x.filter((i) => i.id !== id));
  };

  const exportCsv = () => {
    const rows = [["id", "time_utc", "label", "confidence", "source"], ...items.map((i) => [i.id, i.created_at, i.label, i.confidence, i.source])];
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: "smokeshield-incidents.csv" }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="Incidents"
        subtitle="Every detection is logged with an annotated snapshot."
        action={
          <div className="flex items-center gap-2">
            {([undefined, "fire", "smoke"] as const).map((f) => (
              <button key={f ?? "all"} onClick={() => setFilter(f)} className={filter === f ? "btn-primary" : "btn-ghost"}>
                {f ? f[0].toUpperCase() + f.slice(1) : "All"}
              </button>
            ))}
            <button onClick={exportCsv} disabled={!items.length} className="btn-ghost"><Download size={16} /> CSV</button>
          </div>
        }
      />
      <div className="card overflow-x-auto">
        {items.length === 0 ? (
          <Empty icon={<History size={32} />} text="No incidents recorded" />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-ink-700 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-4">Snapshot</th><th>Type</th><th>Confidence</th><th>Source</th><th>Time (local)</th><th />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-b border-ink-800 last:border-0 hover:bg-ink-800/50">
                  <td className="p-4">
                    {i.snapshot_url && (
                      <img src={i.snapshot_url} alt="" onClick={() => setPreview(i)} className="h-12 w-20 cursor-zoom-in rounded-md object-cover" />
                    )}
                  </td>
                  <td><LabelBadge label={i.label} /></td>
                  <td className="tabular-nums">{Math.round(i.confidence * 100)}%</td>
                  <td className="capitalize text-slate-400">{i.source}</td>
                  <td className="text-slate-400">{new Date(i.created_at + "Z").toLocaleString()}</td>
                  <td className="pr-4 text-right">
                    <button onClick={() => remove(i.id)} aria-label="Delete incident" className="rounded-md p-2 text-slate-500 hover:bg-red-500/10 hover:text-red-400">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {preview?.snapshot_url && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-6" onClick={() => setPreview(null)}>
          <img src={preview.snapshot_url} alt="Incident snapshot" className="max-h-full max-w-full rounded-xl" />
        </div>
      )}
    </>
  );
}
