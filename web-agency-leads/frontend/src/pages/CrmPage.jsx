import { Archive, ArrowUpRight, Bell, CheckSquare, Clock3, Filter, GripVertical, KanbanSquare, List, RefreshCw, Save, Trash2, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../components/ui/Badge.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Input, Select } from "../components/ui/Input.jsx";
import { useToast } from "../hooks/useToast.jsx";
import { api } from "../services/api.js";
import { domain, formatDate, pipelineStageOrder, pipelineStages, priorities } from "../utils/format.js";

const baseFilters = { assignedToUserId: "", industryId: "", recommendedServiceId: "", priority: "", reminders: "", emailStatus: "", replyType: "", actionState: "" };

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

function gmailReplyUrl(threadId = "", messageId = "") {
  if (threadId && messageId) return `https://mail.google.com/mail/u/0/#all/${threadId}/${messageId}`;
  if (threadId) return `https://mail.google.com/mail/u/0/#all/${threadId}`;
  return "";
}

function replyBadge(lead) {
  const type = String(lead?.replyClassification || "");
  if (!type) return null;
  const map = {
    INTERESTED: ["Interested", "bg-emerald-50 text-emerald-700 ring-emerald-200"],
    MAYBE_LATER: ["Maybe later", "bg-amber-50 text-amber-700 ring-amber-200"],
    NOT_INTERESTED: ["Not interested", "bg-slate-100 text-slate-700 ring-slate-200"],
    ASKED_FOR_PRICE: ["Asked for price", "bg-cyan-50 text-cyan-700 ring-cyan-200"],
    ASKED_FOR_MORE_INFO: ["Asked for more info", "bg-blue-50 text-blue-700 ring-blue-200"],
    WRONG_CONTACT: ["Wrong contact", "bg-orange-50 text-orange-700 ring-orange-200"],
    AUTO_REPLY: ["Auto-reply", "bg-violet-50 text-violet-700 ring-violet-200"],
    OTHER: ["Other reply", "bg-slate-100 text-slate-700 ring-slate-200"]
  };
  const [label, className] = map[type] || [type.toLowerCase().replaceAll("_", " "), "bg-slate-100 text-slate-700 ring-slate-200"];
  return { label, className };
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
  const [view, setView] = useState("kanban");
  const [syncingReplies, setSyncingReplies] = useState(false);
  const [replySyncProgress, setReplySyncProgress] = useState(null);

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

  async function syncReplies() {
    setSyncingReplies(true);
    setReplySyncProgress({ percent: 8, label: "Preparing Gmail reply sync..." });
    const progressTimer = setInterval(() => {
      setReplySyncProgress((current) => current ? {
        ...current,
        percent: Math.min(current.percent >= 75 ? current.percent + 3 : current.percent + 8, 92),
        label: current.percent < 35 ? "Checking sent outreach..." : current.percent < 70 ? "Scanning recent Gmail messages..." : "Matching replies to leads..."
      } : current);
    }, 450);
    try {
      const { data } = await api.post("/gmail/sync-replies");
      clearInterval(progressTimer);
      setReplySyncProgress({ percent: 100, label: `Sync complete: ${data.leadsUpdated} leads updated.` });
      push(`Reply sync complete: ${data.repliesFound} replies found, ${data.leadsUpdated} leads updated.`);
      await loadCrm();
      setTimeout(() => setReplySyncProgress(null), 1800);
    } catch (error) {
      clearInterval(progressTimer);
      setReplySyncProgress({ percent: 100, label: error.response?.data?.message || "Reply sync failed." });
      push(error.response?.data?.message || "Reply sync failed. Check Gmail connection and backend logs.", "error");
      setTimeout(() => setReplySyncProgress(null), 2400);
    } finally {
      setSyncingReplies(false);
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

  async function bulkArchive() {
    if (!selected.length) return push("Select leads first", "error");
    const { data } = await api.put("/leads/bulk", { leadIds: selected, status: "ARCHIVED" });
    push(`Archived ${data.updated} leads`);
    setSelected([]);
    await loadCrm();
  }

  async function bulkDelete() {
    if (!selected.length) return push("Select leads first", "error");
    if (!confirm(`Delete ${selected.length} selected leads?`)) return;
    const { data } = await api.delete("/leads/bulk", { data: { leadIds: selected } });
    push(`Deleted ${data.deleted} leads`);
    setSelected([]);
    await loadCrm();
  }

  async function bulkClassifyReplies() {
    if (!selected.length) return push("Select leads first", "error");
    let updated = 0;
    for (const leadId of selected) {
      try {
        await api.post(`/leads/${leadId}/classify-reply`);
        updated += 1;
      } catch {}
    }
    push(`Classified replies for ${updated} leads`);
    await loadCrm();
  }

  async function bulkDoNotContact() {
    if (!selected.length) return push("Select leads first", "error");
    const reason = prompt("Reason for do-not-contact?", "manual_bulk_do_not_contact");
    if (reason == null) return;
    let updated = 0;
    for (const leadId of selected) {
      try {
        await api.post(`/leads/${leadId}/do-not-contact`, { reason });
        updated += 1;
      } catch {}
    }
    push(`Marked ${updated} leads do not contact`);
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
  const allLeads = columns.flatMap((column) => column.leads.map((lead) => ({ ...lead, pipelineStage: column.stage })));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">CRM pipeline</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Sales board</h1>
          <p className="mt-2 max-w-2xl text-slate-500">Move leads from first draft to won work, assign owners, and keep follow-ups visible.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={syncReplies} disabled={syncingReplies}><RefreshCw size={16} /> {syncingReplies ? "Syncing replies..." : "Sync Replies"}</Button>
          <div className="flex rounded-lg bg-slate-100 p-1">
            <button onClick={() => setView("kanban")} className={`rounded-md p-2 ${view === "kanban" ? "bg-white shadow-sm" : "text-slate-500"}`} aria-label="Kanban view"><KanbanSquare size={16} /></button>
            <button onClick={() => setView("table")} className={`rounded-md p-2 ${view === "table" ? "bg-white shadow-sm" : "text-slate-500"}`} aria-label="Table view"><List size={16} /></button>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Visible pipeline</p>
            <p className="mt-1 text-2xl font-semibold">{totalLeads} leads</p>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-600"><Filter size={16} /> Pipeline filters</div>
        <div className="grid gap-3 md:grid-cols-6">
          <Select value={filters.assignedToUserId} onChange={(e) => setFilters({ ...filters, assignedToUserId: e.target.value })}>
            <option value="">All owners</option>
            <option value="unassigned">Unassigned</option>
            {catalog.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </Select>
          <Select value={filters.industryId} onChange={(e) => setFilters({ ...filters, industryId: e.target.value })}>
            <option value="">All industries</option>
            {catalog.industries.map((industry) => <option key={industry.id} value={industry.id}>{industry.name}</option>)}
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
          <Select value={filters.emailStatus} onChange={(e) => setFilters({ ...filters, emailStatus: e.target.value })}>
            <option value="">All email states</option>
            <option value="NOT_SENT">Email Not Sent</option>
            <option value="READY_TO_SEND">Approved</option>
            <option value="SENT">Sent</option>
            <option value="REPLIED">Replied</option>
            <option value="BOUNCED">Bounced</option>
            <option value="REJECTED">Failed / rejected</option>
          </Select>
          <Select value={filters.replyType} onChange={(e) => setFilters({ ...filters, replyType: e.target.value })}>
            <option value="">All reply types</option>
            <option value="INTERESTED">Interested</option>
            <option value="MAYBE_LATER">Maybe later</option>
            <option value="NOT_INTERESTED">Not interested</option>
            <option value="ASKED_FOR_PRICE">Asked for price</option>
            <option value="ASKED_FOR_MORE_INFO">Asked for more info</option>
            <option value="WRONG_CONTACT">Wrong contact</option>
            <option value="AUTO_REPLY">Auto-reply</option>
            <option value="OTHER">Other</option>
          </Select>
          <Select value={filters.actionState} onChange={(e) => setFilters({ ...filters, actionState: e.target.value })}>
            <option value="">All actions</option>
            <option value="needs_action">Needs action</option>
            <option value="no_action">No action needed</option>
            <option value="do_not_contact">Do not contact</option>
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

      {replySyncProgress ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-slate-700">{replySyncProgress.label}</p>
            <span className="text-xs font-semibold text-slate-500">{replySyncProgress.percent}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-slate-950 transition-all duration-300" style={{ width: `${replySyncProgress.percent}%` }} />
          </div>
        </div>
      ) : null}

      {selected.length > 0 && (
        <div className="sticky top-20 z-10 rounded-2xl border border-slate-200 bg-white p-3 shadow-soft">
          <div className="grid gap-3 md:grid-cols-[auto_1fr_1fr_1fr_auto_auto_auto_auto_auto] md:items-center">
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
            <Button variant="secondary" onClick={bulkClassifyReplies}>Classify replies</Button>
            <Button variant="secondary" onClick={bulkDoNotContact}>Mark DNC</Button>
            <Button variant="secondary" onClick={bulkArchive}><Archive size={16} /> Archive</Button>
            <Button variant="danger" onClick={bulkDelete}><Trash2 size={16} /> Delete</Button>
          </div>
        </div>
      )}

      {view === "table" ? (
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3"></th>
                  <th className="px-4 py-3">Lead</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Industry</th>
                  <th className="px-4 py-3">Service</th>
                  <th className="px-4 py-3">Value</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {allLeads.map((lead) => (
                  (() => {
                    const classification = replyBadge(lead);
                    return (
                  <tr key={lead.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3"><input type="checkbox" checked={selected.includes(lead.id)} onChange={() => toggleLead(lead.id)} /></td>
                    <td className="px-4 py-3">
                      <Link to={`/leads/${lead.id}`} className="font-semibold text-slate-950 hover:underline">{lead.company}</Link>
                      <a href={lead.website} target="_blank" rel="noreferrer" className="mt-1 block text-xs text-slate-500">{domain(lead.website)}</a>
                    </td>
                    <td className="px-4 py-3"><Badge className={pipelineStages[lead.pipelineStage]?.className}>{pipelineStages[lead.pipelineStage]?.label}</Badge></td>
                    <td className="px-4 py-3">
                      <Badge className={lead.emailStatus === "REPLIED" || lead.repliedAt ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : lead.emailStatus === "BOUNCED" || lead.bouncedAt ? "bg-rose-50 text-rose-700 ring-rose-200" : lead.emailStatus === "SENT" || lead.lastEmailSentAt ? "bg-indigo-50 text-indigo-700 ring-indigo-200" : lead.emailStatus === "READY_TO_SEND" ? "bg-violet-50 text-violet-700 ring-violet-200" : lead.emailStatus === "REJECTED" ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-slate-100 text-slate-700 ring-slate-200"}>
                        {lead.emailStatus === "READY_TO_SEND" ? "Approved" : lead.emailStatus || (lead.repliedAt ? "REPLIED" : lead.lastEmailSentAt ? "SENT" : "NOT_SENT")}
                      </Badge>
                      {classification ? <Badge className={`mt-2 ${classification.className}`}>{classification.label}</Badge> : null}
                      {lead.needsAction ? <Badge className="mt-2 bg-amber-50 text-amber-700 ring-amber-200">Needs action</Badge> : null}
                      {lead.doNotContact ? <Badge className="mt-2 bg-zinc-100 text-zinc-700 ring-zinc-200">Do not contact</Badge> : null}
                      {lead.lastReplySnippet ? <p className="mt-2 max-w-xs line-clamp-2 text-xs text-slate-500">{lead.lastReplySnippet}</p> : null}
                      {lead.lastReplySnippet && (lead.gmailThreadId || lead.lastReplyMessageId) ? (
                        <a href={gmailReplyUrl(lead.gmailThreadId, lead.lastReplyMessageId)} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-900">
                          <ArrowUpRight size={13} /> Open replied email
                        </a>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{lead.industryRef?.name || lead.industry || "-"}</td>
                    <td className="px-4 py-3 text-slate-600">{lead.serviceOpportunities?.[0]?.service?.name || "-"}</td>
                    <td className="px-4 py-3 text-slate-600">{lead.serviceOpportunities?.[0] ? `$${lead.serviceOpportunities[0].estimatedMinValue.toLocaleString()} - $${lead.serviceOpportunities[0].estimatedMaxValue.toLocaleString()}` : lead.estimatedProjectValue || "-"}</td>
                    <td className="px-4 py-3 text-slate-600">{lead.assignedTo?.name || "Unassigned"}</td>
                    <td className="px-4 py-3 font-semibold">{lead.score}/10</td>
                  </tr>
                    );
                  })()
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : <div className="space-y-6">
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
                      (() => {
                        const classification = replyBadge(lead);
                        return (
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
                          <Badge className={lead.emailStatus === "REPLIED" || lead.repliedAt ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : lead.emailStatus === "BOUNCED" || lead.bouncedAt ? "bg-rose-50 text-rose-700 ring-rose-200" : lead.emailStatus === "SENT" || lead.lastEmailSentAt ? "bg-indigo-50 text-indigo-700 ring-indigo-200" : lead.emailStatus === "READY_TO_SEND" ? "bg-violet-50 text-violet-700 ring-violet-200" : lead.emailStatus === "REJECTED" ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-slate-100 text-slate-700 ring-slate-200"}>
                            {lead.emailStatus === "READY_TO_SEND" ? "Approved" : lead.emailStatus || (lead.repliedAt ? "REPLIED" : lead.lastEmailSentAt ? "SENT" : "NOT_SENT")}
                          </Badge>
                          {classification ? <Badge className={classification.className}>{classification.label}</Badge> : null}
                          {lead.needsAction ? <Badge className="bg-amber-50 text-amber-700 ring-amber-200">Needs action</Badge> : null}
                          {lead.doNotContact ? <Badge className="bg-zinc-100 text-zinc-700 ring-zinc-200">Do not contact</Badge> : null}
                        </div>
                        <p className="mb-3 text-sm text-slate-500">{lead.industryRef?.name || lead.industry || "No industry"} · {lead.serviceOpportunities?.[0]?.service?.name || "No service"}</p>
                        {lead.lastReplySnippet ? <p className="mb-3 line-clamp-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{lead.lastReplySnippet}</p> : null}
                        {lead.lastReplySnippet && (lead.gmailThreadId || lead.lastReplyMessageId) ? (
                          <a href={gmailReplyUrl(lead.gmailThreadId, lead.lastReplyMessageId)} target="_blank" rel="noreferrer" className="mb-3 inline-flex items-center gap-2 text-xs font-semibold text-emerald-700 hover:text-emerald-900">
                            <ArrowUpRight size={13} /> Open replied email
                          </a>
                        ) : null}
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
                        );
                      })()
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
      </div>}

      {loading && <p className="text-sm text-slate-500">Refreshing pipeline...</p>}
    </div>
  );
}
