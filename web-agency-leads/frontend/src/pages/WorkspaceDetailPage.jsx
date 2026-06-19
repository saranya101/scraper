import { ArrowRight, FileText, Play, Send, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge } from "../components/ui/Badge.jsx";
import { Button } from "../components/ui/Button.jsx";
import { api } from "../services/api.js";
import { formatDate, priorities, statuses } from "../utils/format.js";
import { workspaceLabel } from "../utils/workspaces.js";
import DashboardPage from "./DashboardPage.jsx";

const statCards = [
  ["total", "Total leads"],
  ["hot", "HOT"],
  ["warm", "WARM"],
  ["cold", "COLD"],
  ["contacted", "Contacted"],
  ["replied", "Replied"]
];

export default function WorkspaceDetailPage() {
  const { industrySlug } = useParams();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/workspaces/${industrySlug}`)
      .then(({ data }) => setWorkspace(data))
      .catch(() => setWorkspace(null))
      .finally(() => setLoading(false));
  }, [industrySlug]);

  const industry = workspace?.industry || { name: workspaceLabel(industrySlug), slug: industrySlug };

  function runIndustryScan(template) {
    const query = new URLSearchParams({
      industry: industry.slug,
      name: industry.name,
      ...(template?.id ? { templateId: template.id } : {})
    });
    navigate(`/scanner?${query.toString()}`);
  }

  return (
    <div className="space-y-8">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 p-6 text-white shadow-sm md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">Industry workspace</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">{industry.name}</h1>
            <p className="mt-2 max-w-2xl text-slate-400">{industry.description || "A focused workspace for this niche’s leads, scans, service opportunities, and outreach drafts."}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => runIndustryScan()}><Play size={16} /> Run scan</Button>
            <Link to="/workspaces" className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/10 hover:bg-white/15">
              All workspaces <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {statCards.map(([key, label]) => (
          <div key={key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight">{workspace?.stats?.[key] ?? 0}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Sparkles size={18} /> Recommended services</h2>
            <Badge className="bg-slate-100 text-slate-700 ring-slate-200">{workspace?.recommendedServices?.length || 0} active</Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {(workspace?.recommendedServices || []).map((item) => (
              <div key={item.service.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{item.service.name}</p>
                    <p className="mt-1 text-sm text-slate-500">{item.count} recommended leads</p>
                  </div>
                  <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200">{item.averageScore}/10</Badge>
                </div>
                <p className="mt-3 text-sm text-slate-600">${item.estimatedMinValue.toLocaleString()} - ${item.estimatedMaxValue.toLocaleString()} estimated pipeline</p>
              </div>
            ))}
            {!loading && !workspace?.recommendedServices?.length && <p className="text-sm text-slate-500">No recommendations yet. Run scans or reprocess opportunities for this workspace.</p>}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><FileText size={18} /> Scanner templates</h2>
          <div className="space-y-2">
            {(workspace?.templates || []).map((template) => (
              <button key={template.id} onClick={() => runIndustryScan(template)} className="w-full rounded-2xl border border-slate-200 p-4 text-left transition hover:bg-slate-50">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{template.name}</p>
                    <p className="text-sm text-slate-500">{template.keyword} · {template.location}</p>
                  </div>
                  <Play size={16} className="text-slate-400" />
                </div>
              </button>
            ))}
            {!loading && !workspace?.templates?.length && <p className="text-sm text-slate-500">No templates saved for this industry yet.</p>}
          </div>
        </section>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Send size={18} /> Outreach drafts</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {(workspace?.outreachDrafts || []).map((lead) => (
            <Link key={lead.id} to={`/leads/${lead.id}`} className="rounded-2xl border border-slate-200 p-4 transition hover:bg-slate-50">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{lead.company}</p>
                <div className="flex gap-2">
                  <Badge className={priorities[lead.priority]?.className}>{priorities[lead.priority]?.label}</Badge>
                  <Badge className={statuses[lead.status]?.className}>{statuses[lead.status]?.label}</Badge>
                </div>
              </div>
              <p className="line-clamp-2 text-sm text-slate-600">{lead.outreachEmail}</p>
              <p className="mt-3 text-xs text-slate-400">Updated {formatDate(lead.updatedAt)}</p>
            </Link>
          ))}
          {!loading && !workspace?.outreachDrafts?.length && <p className="text-sm text-slate-500">No outreach drafts for this workspace yet.</p>}
        </div>
      </section>

      <DashboardPage workspaceSlug={industrySlug} workspaceIndustryName={industry.name} embedded />
    </div>
  );
}
