import { ArrowRight, BriefcaseBusiness, Flame, Layers3, ThermometerSun } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../components/ui/Badge.jsx";
import { api } from "../services/api.js";
import { workspaceNav } from "../utils/workspaces.js";

export default function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/workspaces")
      .then(({ data }) => setWorkspaces(data))
      .catch(() => setWorkspaces([]))
      .finally(() => setLoading(false));
  }, []);

  const bySlug = new Map(workspaces.map((workspace) => [workspace.industry.slug, workspace]));
  const cards = workspaceNav.map((item) => bySlug.get(item.slug) || { industry: item, stats: {} });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">Industry workspaces</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Separate pipelines for each niche</h1>
        <p className="mt-2 max-w-2xl text-slate-500">Keep scanning, lead review, services, and outreach focused by industry instead of managing one giant pool.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((workspace) => (
          <Link key={workspace.industry.slug} to={`/workspaces/${workspace.industry.slug}`} className="group rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft">
            <div className="flex items-start justify-between gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-950 text-white">
                <Layers3 size={20} />
              </div>
              <ArrowRight size={18} className="text-slate-300 transition group-hover:translate-x-1 group-hover:text-slate-700" />
            </div>
            <h2 className="mt-5 text-xl font-semibold tracking-tight">{workspace.industry.name || workspace.industry.label}</h2>
            <p className="mt-1 text-sm text-slate-500">{workspace.industry.description || "Focused lead queue, scanner templates, and outreach drafts."}</p>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-slate-50 p-3">
                <BriefcaseBusiness size={15} className="text-slate-400" />
                <p className="mt-2 text-2xl font-semibold">{workspace.stats.total || 0}</p>
                <p className="text-xs text-slate-400">Leads</p>
              </div>
              <div className="rounded-2xl bg-rose-50 p-3">
                <Flame size={15} className="text-rose-500" />
                <p className="mt-2 text-2xl font-semibold">{workspace.stats.hot || 0}</p>
                <p className="text-xs text-rose-500">HOT</p>
              </div>
              <div className="rounded-2xl bg-amber-50 p-3">
                <ThermometerSun size={15} className="text-amber-500" />
                <p className="mt-2 text-2xl font-semibold">{workspace.stats.warm || 0}</p>
                <p className="text-xs text-amber-600">WARM</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge className="bg-slate-100 text-slate-700 ring-slate-200">{workspace.stats.cold || 0} COLD</Badge>
              <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200">{workspace.stats.replied || 0} replied</Badge>
            </div>
          </Link>
        ))}
      </div>

      {loading && <p className="text-sm text-slate-500">Loading workspaces...</p>}
    </div>
  );
}
