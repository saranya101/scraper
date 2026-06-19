import { Bell, CheckSquare, Clock3, Filter, GripVertical, Save, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../components/ui/Badge.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Input, Select } from "../components/ui/Input.jsx";
import { useToast } from "../hooks/useToast.jsx";
import { api } from "../services/api.js";
import { domain, formatDate, pipelineStageOrder, pipelineStages, priorities } from "../utils/format.js";

const baseFilters = { assignedToUserId: "", industry: "", recommendedServiceId: "", priority: "", reminders: "" };

function reminderState(date) {
  if (!date) return null;
  const due = new Date(date) <= new Date();
  return due ? "Due" : "Reminder";
}

function readSavedViews() {
  try {
    return JSON.parse(localStorage.getItem("crm_saved_views") || "[]");
  } catch {
    return [];
  }
}

export default function CrmPage() {
  const { push } = useToast();
  const [columns, setColumns] = useState([]);
  const [catalog, setCatalog] = useState({ industries: [], services: [], users: [] });
  const [activity, setActivity] = useState([]);
  const [filters, setFilters] = useState(() => {
    try {
      return { ...baseFilters, ...JSON.parse(localStorage.getItem("crm_filters") || "{}") };
    } catch {
      return baseFilters;
    }
  });
  const [selected, setSelected] = useState([]);
  const [bulkStage, setBulkStage] = useState("");
  const [bulkOwner, setBulkOwner] = useState("KEEP");
  const [bulkReminder, setBulkReminder] = useState("");
  const [savedViews, setSavedViews] = useState(readSavedViews);
  const [viewName, setViewName] = useState("");
  const [draggingId, setDraggingId] = useState("");
  const [loading, setLoading] = useState(true);

  const params = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), [filters]);

  async function loadCrm() {
    setLoading(true);
    try {
      const [{ data: pipeline }, { data: feed }] = await Promise.all([
        api.get("/leads/pipeline", { params }),
        api.get("/activity")
      ]);
      setColumns(pipeline.columns);
      setActivity(feed);
    } catch (error) {
      push(error.response?.data?.message || "Could not load CRM", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api.get("/leads/meta/catalog").then(({ data }) => setCatalog(data)).catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem("crm_filters", JSON.stringify(filters));
    const timer = setTimeout(loadCrm, 200);
    return () => clearTimeout(timer);
  }, [JSON.stringify(params)]);

  function toggleLead(id) {
    setSelected((items) => (items.includes(id) ? items.filter((item) => item !== id) : [...items, id]));
  }

  async function moveLead(leadId, stage) {
    const previous = columns;
    const currentLead = previous.flatMap((item) => item.leads).find((lead) => lead.id === leadId);
    if (!currentLead || currentLead.pipelineStage === stage) return;
    setColumns((current) =>
      current.map((column) => ({
        ...column,
        leads: column.stage === stage
          ? [...column.leads, currentLead].map((lead) => ({ ...lead, pipelineStage: stage }))
          : column.leads.filter((lead) => lead.id !== leadId)
      }))
    );
    try {
      await api.put(`/leads/${leadId}/stage`, { pipelineStage: stage });
      push("Stage updated");
      await loadCrm();
    } catch (error) {
      setColumns(previous);
      push(error.response?.data?.message || "Could not update stage", "error");
    }
  }

  async function assignLead(leadId, assignedToUserId) {
    try {
      await api.put(`/leads/${leadId}/assign`, { assignedToUserId: assignedToUserId || null });
      push("Owner updated");
      await loadCrm();
    } catch (error) {
      push(error.response?.data?.message || "Could not assign owner", "error");
    }
  }

  async function setReminder(leadId, reminderDate) {
    try {
      await api.post(`/leads/${leadId}/reminder`, { reminderDate: reminderDate ? new Date(reminderDate).toISOString() : null });
      push(reminderDate ? "Reminder set" : "Reminder cleared");
      await loadCrm();
    } catch (error) {
      push(error.response?.data?.message || "Could not set reminder", "error");
    }
  }

  async function applyBulkUpdate() {
    if (!selected.length) return push("Select leads first", "error");
    const body = { leadIds: selected };
    if (bulkStage) body.pipelineStage = bulkStage;
    if (bulkOwner !== "KEEP") body.assignedToUserId = bulkOwner || null;
    if (bulkReminder) body.reminderDate = new Date(bulkReminder).toISOString();
    if (!bulkStage && bulkOwner === "KEEP" && !bulkReminder) return push("Choose a bulk update", "error");
    const { data } = await api.put("/leads/bulk", body);
    push(`Updated ${data.updated} leads`);
    setSelected([]);
    setBulkStage("");
    setBulkOwner("KEEP");
    setBulkReminder("");
    await loadCrm();
  }

  function saveView() {
    const name = viewName.trim();
    if (!name) return;
    const next = [{ id: Date.now(), name, filters }, ...savedViews.filter((view) => view.name !== name)].slice(0, 8);
    setSavedViews(next);
    localStorage.setItem("crm_saved_views", JSON.stringify(next));
    setViewName("");
    push("View saved");
  }

  function applyView(view) {
    setFilters({ ...baseFilters, ...view.filters });
  }

  const totalLeads = columns.reduce((sum, column) => sum + column.leads.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">CRM pipeline</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Sales board</h1>
          <p className="mt-2 max-w-2xl text-slate-500">Move leads from first draft to won work, assign owners, and keep follow-ups visible.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Visible pipeline</p>
          <p className="mt-1 text-2xl font-semibold">{totalLeads} leads</p>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-600"><Filter size={16} /> Pipeline filters</div>
        <div className="grid gap-3 md:grid-cols-5">
          <Select value={filters.assignedToUserId} onChange={(e) => setFilters({ ...filters, assignedToUserId: e.target.value })}>
            <option value="">All owners</option>
            <option value="unassigned">Unassigned</option>
            {catalog.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </Select>
          <Select value={filters.industry} onChange={(e) => setFilters({ ...filters, industry: e.target.value })}>
            <option value="">All industries</option>
            {catalog.industries.map((industry) => <option key={industry.id} value={industry.name}>{industry.name}</option>)}
          </Select>
          <Select value={filters.recommendedServiceId} onChange={(e) => setFilters({ ...filters, recommendedServiceId: e.target.value })}>
            <option value="">All services</option>
            {catalog.services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
          </Select>
          <Select value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}>
            <option value="">All priorities</option>
            <option value="HOT">HOT</option>
            <option value="WARM">WARM</option>
            <option value="COLD">COLD</option>
          </Select>
          <Select value={filters.reminders} onChange={(e) => setFilters({ ...filters, reminders: e.target.value })}>
            <option value="">All reminders</option>
            <option value="due">Due reminders</option>
            <option value="upcoming">Upcoming reminders</option>
          </Select>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
          <Input value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="Saved view name" />
          <Button type="button" variant="secondary" onClick={saveView}><Save size={16} /> Save view</Button>
          <Button type="button" variant="ghost" onClick={() => setFilters(baseFilters)}>Clear filters</Button>
          <div className="flex flex-wrap gap-2">
            {savedViews.map((view) => (
              <button key={view.id} onClick={() => applyView(view)} className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200">{view.name}</button>
            ))}
          </div>
        </div>
      </div>

      {selected.length > 0 && (
        <div className="sticky top-20 z-10 rounded-2xl border border-slate-200 bg-white p-3 shadow-soft">
          <div className="grid gap-3 md:grid-cols-[auto_1fr_1fr_1fr_auto] md:items-center">
            <p className="flex items-center gap-2 text-sm font-semibold"><CheckSquare size={16} /> {selected.length} selected</p>
            <Select value={bulkStage} onChange={(e) => setBulkStage(e.target.value)}>
              <option value="">Keep stage</option>
              {pipelineStageOrder.map((stage) => <option key={stage} value={stage}>{pipelineStages[stage].label}</option>)}
            </Select>
            <Select value={bulkOwner} onChange={(e) => setBulkOwner(e.target.value)}>
              <option value="KEEP">Keep owner</option>
              <option value="">Unassigned / clear owner</option>
              {catalog.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </Select>
            <Input type="datetime-local" value={bulkReminder} onChange={(e) => setBulkReminder(e.target.value)} />
            <Button onClick={applyBulkUpdate}>Apply bulk update</Button>
          </div>
        </div>
      )}

      <div className="space-y-6">
        <div className="-mx-4 overflow-x-auto px-4 pb-3 md:-mx-8 md:px-8">
          <div className="flex min-w-max gap-4">
            {pipelineStageOrder.map((stage) => {
              const column = columns.find((item) => item.stage === stage) || { stage, leads: [] };
              return (
                <section
                  key={stage}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const id = event.dataTransfer.getData("leadId") || draggingId;
                    if (id) moveLead(id, stage);
                  }}
                  className="min-h-[560px] w-[340px] shrink-0 rounded-3xl border border-slate-200 bg-slate-100/70 p-4"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold">{pipelineStages[stage].label}</h2>
                      <p className="text-sm text-slate-500">{column.leads.length} leads</p>
                    </div>
                    <Badge className={pipelineStages[stage].className}>{column.leads.length}</Badge>
                  </div>
                  <div className="space-y-4">
                    {column.leads.map((lead) => (
                      <article
                        key={lead.id}
                        draggable
                        onDragStart={(event) => {
                          setDraggingId(lead.id);
                          event.dataTransfer.setData("leadId", lead.id);
                        }}
                        onDragEnd={() => setDraggingId("")}
                        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft"
                      >
                        <div className="mb-4 flex items-start gap-3">
                          <input type="checkbox" checked={selected.includes(lead.id)} onChange={() => toggleLead(lead.id)} className="mt-1 h-4 w-4 rounded border-slate-300" />
                          <GripVertical size={16} className="mt-0.5 text-slate-300" />
                          <div className="min-w-0 flex-1">
                            <Link to={`/leads/${lead.id}`} className="block truncate text-base font-semibold hover:underline">{lead.company}</Link>
                            <a href={lead.website} target="_blank" rel="noreferrer" className="mt-1 block truncate text-sm text-slate-500 hover:text-slate-900">{domain(lead.website)}</a>
                          </div>
                        </div>
                        <div className="mb-3 flex flex-wrap gap-2">
                          <Badge className={priorities[lead.priority]?.className}>{priorities[lead.priority]?.label}</Badge>
                          {lead.reminderDate && <Badge className={new Date(lead.reminderDate) <= new Date() ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-amber-50 text-amber-700 ring-amber-200"}><Bell size={12} /> {reminderState(lead.reminderDate)}</Badge>}
                        </div>
                        <p className="mb-3 text-sm text-slate-500">{lead.industry || "No industry"} · {lead.serviceOpportunities?.[0]?.service?.name || "No service"}</p>
                        <div className="space-y-2">
                          <Select value={lead.assignedToUserId || ""} onChange={(e) => assignLead(lead.id, e.target.value)}>
                            <option value="">Unassigned</option>
                            {catalog.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                          </Select>
                          <Input type="datetime-local" onChange={(e) => setReminder(lead.id, e.target.value)} />
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-slate-400">
                          <span className="flex items-center gap-1"><UserRound size={13} /> {lead.assignedTo?.name || "No owner"}</span>
                          <span>Score {lead.score}/10</span>
                        </div>
                      </article>
                    ))}
                    {!column.leads.length && <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">Drop leads here</div>}
                  </div>
                </section>
              );
            })}
          </div>
        </div>

        <aside className="space-y-4">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Clock3 size={18} /> Activity feed</h2>
            <div className="max-h-[680px] space-y-3 overflow-auto">
              {activity.map((item) => (
                <div key={`${item.type}-${item.id}`} className="rounded-2xl border border-slate-200 p-3">
                  <p className="text-sm font-semibold">{item.lead?.company || "Lead activity"}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {item.type === "STAGE_CHANGED"
                      ? `${item.user?.name || "Someone"} moved ${pipelineStages[item.oldStage]?.label || item.oldStatus || "stage"} to ${pipelineStages[item.newStage]?.label || item.newStatus || "stage"}`
                      : item.note}
                  </p>
                  <p className="mt-2 text-xs text-slate-400">{formatDate(item.createdAt)}</p>
                </div>
              ))}
              {!activity.length && <p className="text-sm text-slate-500">No activity yet.</p>}
            </div>
          </section>
        </aside>
      </div>

      {loading && <p className="text-sm text-slate-500">Refreshing pipeline...</p>}
    </div>
  );
}
