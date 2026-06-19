import { Grid2X2, List, Plus, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import LeadCard from "../components/LeadCard.jsx";
import LeadFormModal from "../components/LeadFormModal.jsx";
import LeadTable from "../components/LeadTable.jsx";
import { LoadingSkeleton } from "../components/LoadingSkeleton.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Input, Select } from "../components/ui/Input.jsx";
import { useToast } from "../hooks/useToast.jsx";
import { api } from "../services/api.js";

const statLabels = [
  ["total", "Total leads"],
  ["hot", "HOT leads"],
  ["warm", "WARM leads"],
  ["cold", "COLD leads"],
  ["contacted", "Contacted"],
  ["replied", "Replied"]
];

export default function DashboardPage() {
  const { push } = useToast();
  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState({});
  const [meta, setMeta] = useState({ page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("cards");
  const [modalLead, setModalLead] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [filters, setFilters] = useState({ search: "", priority: "", status: "", sortBy: "createdAt", sortOrder: "desc", page: 1 });

  const params = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), [filters]);

  async function loadLeads() {
    setLoading(true);
    try {
      const { data } = await api.get("/leads", { params });
      setLeads(data.items);
      setStats(data.stats);
      setMeta(data.meta);
    } catch (error) {
      push(error.response?.data?.message || "Could not load leads", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(loadLeads, 250);
    return () => clearTimeout(timer);
  }, [JSON.stringify(params)]);

  async function saveLead(payload) {
    if (modalLead) {
      await api.put(`/leads/${modalLead.id}`, payload);
      push("Lead updated");
    } else {
      await api.post("/leads", payload);
      push("Lead created");
    }
    await loadLeads();
  }

  async function archiveLead(lead) {
    await api.put(`/leads/${lead.id}`, { ...lead, status: "ARCHIVED" });
    push("Lead archived");
    loadLeads();
  }

  async function deleteLead(lead) {
    if (!confirm(`Delete ${lead.company}?`)) return;
    await api.delete(`/leads/${lead.id}`);
    push("Lead deleted");
    loadLeads();
  }

  function openCreate() {
    setModalLead(null);
    setModalOpen(true);
  }

  function openEdit(lead) {
    setModalLead(lead);
    setModalOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">Redesign pipeline</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Lead dashboard</h1>
          <p className="mt-2 max-w-2xl text-slate-500">Discover weak websites, score opportunity, and move the best prospects through outreach.</p>
        </div>
        <Button onClick={openCreate}><Plus size={16} /> New lead</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {statLabels.map(([key, label]) => (
          <div key={key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight">{stats[key] ?? 0}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[1.4fr_0.7fr_0.8fr_0.8fr_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <Input className="pl-9" placeholder="Search company, industry, location, website" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value, page: 1 })} />
          </div>
          <Select value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value, page: 1 })}>
            <option value="">All priorities</option>
            <option value="HOT">HOT</option>
            <option value="WARM">WARM</option>
            <option value="COLD">COLD</option>
          </Select>
          <Select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value, page: 1 })}>
            <option value="">All statuses</option>
            <option value="NOT_CONTACTED">Not Contacted</option>
            <option value="CONTACTED">Contacted</option>
            <option value="REPLIED">Replied</option>
            <option value="CLOSED">Closed</option>
            <option value="ARCHIVED">Archived</option>
          </Select>
          <Select value={`${filters.sortBy}:${filters.sortOrder}`} onChange={(event) => {
            const [sortBy, sortOrder] = event.target.value.split(":");
            setFilters({ ...filters, sortBy, sortOrder });
          }}>
            <option value="createdAt:desc">Newest</option>
            <option value="score:asc">Best score</option>
            <option value="company:asc">Company A-Z</option>
            <option value="updatedAt:desc">Recently updated</option>
          </Select>
          <div className="flex rounded-lg bg-slate-100 p-1">
            <button onClick={() => setView("cards")} className={`rounded-md p-2 ${view === "cards" ? "bg-white shadow-sm" : "text-slate-500"}`} aria-label="Card view"><Grid2X2 size={16} /></button>
            <button onClick={() => setView("table")} className={`rounded-md p-2 ${view === "table" ? "bg-white shadow-sm" : "text-slate-500"}`} aria-label="Table view"><List size={16} /></button>
          </div>
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : leads.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <SlidersHorizontal className="mx-auto mb-4 text-slate-400" />
          <h3 className="text-lg font-semibold">No leads match this view</h3>
          <p className="mt-2 text-sm text-slate-500">Adjust filters or add a lead manually.</p>
        </div>
      ) : view === "cards" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {leads.map((lead) => <LeadCard key={lead.id} lead={lead} onEdit={openEdit} onArchive={archiveLead} />)}
        </div>
      ) : (
        <LeadTable leads={leads} onEdit={openEdit} onDelete={deleteLead} />
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Page {meta.page || 1} of {meta.totalPages || 1}</p>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={filters.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}>Previous</Button>
          <Button variant="secondary" disabled={meta.page >= meta.totalPages} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>Next</Button>
        </div>
      </div>

      {modalOpen && <LeadFormModal lead={modalLead} onClose={() => setModalOpen(false)} onSave={saveLead} />}
    </div>
  );
}
