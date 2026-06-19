import { Clipboard, MailPlus, RefreshCw, Save, Send, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../components/ui/Badge.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Input, Select, Textarea } from "../components/ui/Input.jsx";
import { useToast } from "../hooks/useToast.jsx";
import { api } from "../services/api.js";
import { domain, formatDate, priorities } from "../utils/format.js";

const outreachTypes = {
  EMAIL: "Email",
  LINKEDIN_DM: "LinkedIn DM",
  FOLLOW_UP_1: "Follow-up 1",
  FOLLOW_UP_2: "Follow-up 2"
};

const tones = ["consultative", "friendly", "direct", "premium", "warm founder-led"];

const emptyDraft = {
  type: "EMAIL",
  subject: "",
  opener: "",
  pitch: "",
  cta: "",
  fullMessage: "",
  status: "DRAFT",
  tone: "consultative"
};

export default function OutreachPage() {
  const { push } = useToast();
  const [catalog, setCatalog] = useState({ industries: [], services: [] });
  const [queue, setQueue] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [selectedDraft, setSelectedDraft] = useState(null);
  const [form, setForm] = useState(emptyDraft);
  const [filters, setFilters] = useState({ industry: "", serviceId: "", type: "", status: "" });
  const [tone, setTone] = useState("consultative");
  const [generating, setGenerating] = useState(false);

  const params = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), [filters]);

  async function loadData() {
    const [queueRes, draftsRes] = await Promise.all([
      api.get("/outreach/queue", { params }),
      api.get("/outreach", { params })
    ]);
    setQueue(queueRes.data);
    setDrafts(draftsRes.data);
    if (!selectedLead && queueRes.data[0]) setSelectedLead(queueRes.data[0]);
  }

  async function loadLeadDrafts(leadId) {
    const { data } = await api.get(`/outreach/${leadId}`);
    setDrafts((current) => {
      const others = current.filter((draft) => draft.leadId !== leadId);
      return [...data, ...others];
    });
    if (data[0]) {
      setSelectedDraft(data[0]);
      setForm({ ...emptyDraft, ...data[0] });
    } else {
      setSelectedDraft(null);
      setForm(emptyDraft);
    }
  }

  useEffect(() => {
    api.get("/leads/meta/catalog").then(({ data }) => setCatalog(data)).catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => loadData().catch(() => push("Could not load outreach", "error")), 200);
    return () => clearTimeout(timer);
  }, [JSON.stringify(params)]);

  async function selectLead(lead) {
    setSelectedLead(lead);
    await loadLeadDrafts(lead.id);
  }

  async function generateDraft(type = form.type || "EMAIL") {
    if (!selectedLead) return push("Select a lead first", "error");
    setGenerating(true);
    try {
      const { data } = await api.post(`/outreach/generate/${selectedLead.id}`, { type, tone });
      setSelectedDraft(data);
      setForm({ ...emptyDraft, ...data });
      push("Outreach generated");
      await loadData();
    } catch (error) {
      push(error.response?.data?.message || "Could not generate outreach", "error");
    } finally {
      setGenerating(false);
    }
  }

  async function saveDraft(status = form.status || "SAVED") {
    if (!selectedDraft) return push("Generate a draft first", "error");
    const { data } = await api.put(`/outreach/${selectedDraft.id}`, { ...form, status });
    setSelectedDraft(data);
    setForm({ ...emptyDraft, ...data });
    push("Draft saved");
    await loadData();
  }

  async function copyDraft() {
    if (!form.fullMessage) return;
    await navigator.clipboard.writeText(form.fullMessage);
    push("Draft copied");
    if (selectedDraft) await api.put(`/outreach/${selectedDraft.id}`, { status: "COPIED" });
    loadData();
  }

  async function deleteDraft() {
    if (!selectedDraft || !confirm("Delete this outreach draft?")) return;
    await api.delete(`/outreach/${selectedDraft.id}`);
    push("Draft deleted");
    setSelectedDraft(null);
    setForm(emptyDraft);
    await loadData();
  }

  function openDraft(draft) {
    setSelectedLead(draft.lead);
    setSelectedDraft(draft);
    setForm({ ...emptyDraft, ...draft });
  }

  const leadDrafts = selectedLead ? drafts.filter((draft) => draft.leadId === selectedLead.id) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">Outreach engine</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Personalized drafts</h1>
          <p className="mt-2 max-w-2xl text-slate-500">Generate, edit, save, and copy outreach using each lead’s audit issues and recommended service.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(outreachTypes).map(([type, label]) => (
            <Button key={type} variant={type === form.type ? "primary" : "secondary"} disabled={!selectedLead || generating} onClick={() => generateDraft(type)}>
              <MailPlus size={16} /> {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-5">
          <Select value={filters.industry} onChange={(e) => setFilters({ ...filters, industry: e.target.value })}>
            <option value="">All industries</option>
            {catalog.industries.map((industry) => <option key={industry.id} value={industry.name}>{industry.name}</option>)}
          </Select>
          <Select value={filters.serviceId} onChange={(e) => setFilters({ ...filters, serviceId: e.target.value })}>
            <option value="">All services</option>
            {catalog.services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
          </Select>
          <Select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
            <option value="">All draft types</option>
            {Object.entries(outreachTypes).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
          </Select>
          <Select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="SAVED">Saved</option>
            <option value="COPIED">Copied</option>
            <option value="SENT">Sent</option>
          </Select>
          <Select value={tone} onChange={(e) => setTone(e.target.value)}>
            {tones.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)_360px]">
        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Queue</h2>
          <div className="max-h-[760px] space-y-3 overflow-auto pr-1">
            {queue.map((lead) => (
              <button key={lead.id} onClick={() => selectLead(lead)} className={`w-full rounded-2xl border p-4 text-left transition ${selectedLead?.id === lead.id ? "border-slate-950 bg-slate-50" : "border-slate-200 hover:bg-slate-50"}`}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{lead.company}</p>
                    <p className="truncate text-sm text-slate-500">{domain(lead.website)}</p>
                  </div>
                  <Badge className={priorities[lead.priority]?.className}>{priorities[lead.priority]?.label}</Badge>
                </div>
                <p className="text-sm text-slate-600">{lead.industry || "No industry"} · {lead.serviceOpportunities?.[0]?.service?.name || "No recommended service"}</p>
                <p className="mt-2 text-xs text-slate-400">{lead.outreachDrafts?.length ? "Draft exists" : "Needs draft"}</p>
              </button>
            ))}
            {!queue.length && <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No leads match this outreach queue.</p>}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-xl font-semibold">{selectedLead?.company || "Select a lead"}</h2>
              {selectedLead && (
                <p className="mt-1 text-sm text-slate-500">
                  <Link to={`/leads/${selectedLead.id}`} className="hover:text-slate-950">{domain(selectedLead.website)}</Link> · {selectedLead.industry || "No industry"}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={!selectedLead || generating} onClick={() => generateDraft(form.type)}><RefreshCw size={16} /> Regenerate</Button>
              <Button variant="secondary" disabled={!selectedDraft} onClick={() => saveDraft("SAVED")}><Save size={16} /> Save draft</Button>
              <Button disabled={!form.fullMessage} onClick={copyDraft}><Clipboard size={16} /> Copy</Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label>
              <span className="mb-1.5 block text-sm font-medium">Type</span>
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {Object.entries(outreachTypes).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
              </Select>
            </label>
            <label>
              <span className="mb-1.5 block text-sm font-medium">Status</span>
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="DRAFT">Draft</option>
                <option value="SAVED">Saved</option>
                <option value="COPIED">Copied</option>
                <option value="SENT">Sent</option>
                <option value="ARCHIVED">Archived</option>
              </Select>
            </label>
            {form.type === "EMAIL" && (
              <label className="md:col-span-2">
                <span className="mb-1.5 block text-sm font-medium">Subject</span>
                <Input value={form.subject || ""} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
              </label>
            )}
            <label className="md:col-span-2">
              <span className="mb-1.5 block text-sm font-medium">Opener</span>
              <Textarea value={form.opener || ""} onChange={(e) => setForm({ ...form, opener: e.target.value })} />
            </label>
            <label className="md:col-span-2">
              <span className="mb-1.5 block text-sm font-medium">Pitch</span>
              <Textarea value={form.pitch || ""} onChange={(e) => setForm({ ...form, pitch: e.target.value })} />
            </label>
            <label className="md:col-span-2">
              <span className="mb-1.5 block text-sm font-medium">CTA</span>
              <Textarea value={form.cta || ""} onChange={(e) => setForm({ ...form, cta: e.target.value })} />
            </label>
            <label className="md:col-span-2">
              <span className="mb-1.5 block text-sm font-medium">Full message</span>
              <Textarea className="min-h-64 font-mono" value={form.fullMessage || ""} onChange={(e) => setForm({ ...form, fullMessage: e.target.value })} />
            </label>
          </div>

          <div className="mt-5 flex justify-between">
            <Button variant="ghost" disabled={!selectedDraft} onClick={deleteDraft}><Trash2 size={16} /> Delete</Button>
            <Button variant="secondary" disabled={!selectedDraft} onClick={() => saveDraft("SENT")}><Send size={16} /> Mark sent</Button>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Drafts</h2>
          <div className="mb-5 space-y-2">
            {leadDrafts.map((draft) => (
              <button key={draft.id} onClick={() => openDraft(draft)} className={`w-full rounded-2xl border p-3 text-left ${selectedDraft?.id === draft.id ? "border-slate-950 bg-slate-50" : "border-slate-200 hover:bg-slate-50"}`}>
                <p className="font-semibold">{outreachTypes[draft.type]}</p>
                <p className="line-clamp-2 text-sm text-slate-500">{draft.subject || draft.opener || draft.fullMessage}</p>
                <p className="mt-2 text-xs text-slate-400">{draft.status} · {formatDate(draft.updatedAt)}</p>
              </button>
            ))}
            {selectedLead && !leadDrafts.length && <p className="rounded-2xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">No drafts for this lead yet.</p>}
          </div>

          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">All recent drafts</h3>
          <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
            {drafts.map((draft) => (
              <button key={draft.id} onClick={() => openDraft(draft)} className="w-full rounded-2xl border border-slate-200 p-3 text-left hover:bg-slate-50">
                <p className="truncate text-sm font-semibold">{draft.lead?.company}</p>
                <p className="text-xs text-slate-500">{outreachTypes[draft.type]} · {draft.status}</p>
              </button>
            ))}
            {!drafts.length && <p className="text-sm text-slate-500">No outreach drafts yet.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
