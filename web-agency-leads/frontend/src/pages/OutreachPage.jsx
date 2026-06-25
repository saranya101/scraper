import { Clipboard, Eye, Link2, Mail, MailPlus, MessageCircle, Phone, Plug, RefreshCw, Save, Send, Trash2 } from "lucide-react";
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
  COLD_CALL: "Cold call",
  FOLLOW_UP_1: "Follow-up 1",
  FOLLOW_UP_2: "Follow-up 2"
};

const statuses = ["DRAFT", "SAVED", "COPIED", "SENT", "ARCHIVED"];
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

function contactRows(lead) {
  if (!lead) return [];
  return [
    ["General email", lead.generalEmail, Mail],
    ["Owner email", lead.ownerEmail, Mail],
    ["LinkedIn", lead.linkedinCompany, Link2],
    ["Instagram", lead.instagram, MessageCircle],
    ["Facebook", lead.facebook, MessageCircle],
    ["WhatsApp", lead.whatsapp, Phone]
  ].filter(([, value]) => value);
}

function previewMessage(form) {
  if (!form.fullMessage && !form.opener && !form.pitch && !form.cta) return "";
  if (form.fullMessage) return form.fullMessage;
  return [form.subject ? `Subject: ${form.subject}` : null, form.opener, "", form.pitch, "", form.cta].filter((part) => part !== null).join("\n");
}

function emailRecipientBody(form) {
  const body = form.fullMessage || [form.opener, "", form.pitch, "", form.cta].filter((part) => part !== null).join("\n");
  return body.replace(/^subject:\s?.*(\r?\n){1,2}/i, "").trim();
}

function draftForm(draft, fallbackType = "EMAIL") {
  const type = draft?.type || fallbackType;
  const next = { ...emptyDraft, ...draft, type };
  next.subject = type === "EMAIL" ? next.subject || "" : "";
  next.fullMessage = previewMessage(next);
  return next;
}

export default function OutreachPage() {
  const { push } = useToast();
  const [catalog, setCatalog] = useState({ industries: [], services: [] });
  const [queue, setQueue] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [leadDrafts, setLeadDrafts] = useState([]);
  const [emailAccounts, setEmailAccounts] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [selectedDraft, setSelectedDraft] = useState(null);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [confirmSend, setConfirmSend] = useState(false);
  const [form, setForm] = useState(emptyDraft);
  const [filters, setFilters] = useState({ industryId: "", serviceId: "", type: "", status: "" });
  const [tone, setTone] = useState("consultative");
  const [activeTab, setActiveTab] = useState("edit");
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);

  const params = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), [filters]);
  const messagePreview = previewMessage(form);
  const emailBody = emailRecipientBody(form);
  const gmailSender = emailAccounts.find((account) => account.provider === "GOOGLE");
  const gmailReady = Boolean(gmailSender?.configured && gmailSender?.active);

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
    setLeadDrafts(data);
    setDrafts((current) => {
      const others = current.filter((draft) => draft.leadId !== leadId);
      return [...data, ...others];
    });
  }

  useEffect(() => {
    api.get("/leads/meta/catalog").then(({ data }) => setCatalog(data)).catch(() => {});
    api.get("/email/accounts").then(({ data }) => setEmailAccounts(data)).catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => loadData().catch(() => push("Could not load outreach", "error")), 200);
    return () => clearTimeout(timer);
  }, [JSON.stringify(params)]);

  useEffect(() => {
    if (selectedLead) loadLeadDrafts(selectedLead.id).catch(() => {});
  }, [selectedLead?.id]);

  function selectLead(lead) {
    setSelectedLead(lead);
    setSelectedDraft(null);
    setForm(emptyDraft);
    setRecipientEmail(lead.ownerEmail || lead.generalEmail || "");
    setActiveTab("edit");
  }

  async function generateDraft(type = form.type || "EMAIL") {
    if (!selectedLead) return push("Select a lead first", "error");
    setGenerating(true);
    try {
      const { data } = await api.post(`/outreach/generate/${selectedLead.id}`, { type, tone });
      const generatedForm = draftForm(data, type);
      setSelectedDraft(data);
      setSelectedLead(data.lead || selectedLead);
      setRecipientEmail(data.lead?.ownerEmail || data.lead?.generalEmail || selectedLead.ownerEmail || selectedLead.generalEmail || recipientEmail);
      setForm(generatedForm);
      setActiveTab("edit");
      push("Outreach generated");
      loadData().catch(() => {});
      loadLeadDrafts(selectedLead.id).catch(() => {});
    } catch (error) {
      push(error.response?.data?.message || "Could not generate outreach", "error");
    } finally {
      setGenerating(false);
    }
  }

  async function saveDraft(status = form.status || "SAVED") {
    if (!selectedDraft) return push("Generate or open a draft first", "error");
    const { data } = await api.put(`/outreach/${selectedDraft.id}`, { ...form, status });
    setSelectedDraft(data);
    setSelectedLead(data.lead || selectedLead);
    setForm(draftForm(data, form.type));
    push(status === "SENT" ? "Marked sent" : "Draft saved");
    await Promise.all([loadData(), loadLeadDrafts(data.leadId)]);
  }

  async function sendEmail() {
    if (!selectedLead) return push("Select a lead first", "error");
    if (!gmailReady) return push("Connect ociastudios@gmail.com before sending", "error");
    if (!recipientEmail) return push("Add a recipient email first", "error");
    if (!form.subject) return push("Add an email subject first", "error");
    if (!emailBody) return push("Add an email body first", "error");
    setSending(true);
    try {
      const { data } = await api.post("/email/send", {
        leadId: selectedLead.id,
        outreachDraftId: selectedDraft?.id || null,
        toEmail: recipientEmail,
        subject: form.subject,
        body: emailBody
      });
      if (data.status === "SENT") {
        push("Email sent");
        setConfirmSend(false);
        setForm({ ...form, status: "SENT" });
        await Promise.all([loadData(), loadLeadDrafts(selectedLead.id)]);
      } else {
        push(data.errorMessage || "Email send failed", "error");
      }
    } catch (error) {
      push(error.response?.data?.message || "Email send failed", "error");
    } finally {
      setSending(false);
    }
  }

  async function copyDraft() {
    if (!messagePreview) return;
    await navigator.clipboard.writeText(messagePreview);
    push("Draft copied");
    if (selectedDraft) await api.put(`/outreach/${selectedDraft.id}`, { status: "COPIED" });
    loadData();
  }

  async function deleteDraft(draft = selectedDraft) {
    if (!draft || !confirm("Delete this outreach draft?")) return;
    await api.delete(`/outreach/${draft.id}`);
    push("Draft deleted");
    if (selectedDraft?.id === draft.id) {
      setSelectedDraft(null);
      setForm(emptyDraft);
      setActiveTab("edit");
    }
    await Promise.all([loadData(), draft.leadId ? loadLeadDrafts(draft.leadId) : Promise.resolve()]);
  }

  async function copyContact(value) {
    await navigator.clipboard.writeText(value || "");
    push("Contact copied");
  }

  function openDraft(draft) {
    setSelectedLead(draft.lead || selectedLead);
    setSelectedDraft(draft);
    setForm(draftForm(draft));
    setActiveTab("edit");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">Outreach engine</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Personalized drafts</h1>
          <p className="mt-2 max-w-2xl text-slate-500">Generate, edit, preview, and mark outreach as sent. Connectors are staged for later sending integrations.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-44">
            {Object.entries(outreachTypes).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
          </Select>
          <Button disabled={!selectedLead || generating} onClick={() => generateDraft(form.type)}>
            <MailPlus size={16} /> {generating ? "Generating..." : "Generate"}
          </Button>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-5">
          <Select value={filters.industryId} onChange={(e) => setFilters({ ...filters, industryId: e.target.value })}>
            <option value="">All industries</option>
            {catalog.industries.map((industry) => <option key={industry.id} value={industry.id}>{industry.name}</option>)}
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
            {statuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
          </Select>
          <Select value={tone} onChange={(e) => setTone(e.target.value)}>
            {tones.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[390px_minmax(0,1fr)]">
        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Outreach queue</h2>
            <Badge className="bg-slate-100 text-slate-700 ring-slate-200">{queue.length} leads</Badge>
          </div>
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
                <p className="text-sm text-slate-600">{lead.industryRef?.name || lead.industry || "No industry"} · {lead.serviceOpportunities?.[0]?.service?.name || "No recommended service"}</p>
                <p className="mt-2 text-xs text-slate-400">{lead.outreachDrafts?.length ? "Draft exists" : "Needs draft"}</p>
              </button>
            ))}
            {!queue.length && <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No leads match this outreach queue.</p>}
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-xl font-semibold">{selectedLead?.company || "Select a lead"}</h2>
                {selectedLead && (
                  <p className="mt-1 text-sm text-slate-500">
                    <Link to={`/leads/${selectedLead.id}`} className="hover:text-slate-950">{domain(selectedLead.website)}</Link> · {selectedLead.industryRef?.name || selectedLead.industry || "No industry"}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={!selectedLead || generating} onClick={() => generateDraft(form.type)}><RefreshCw size={16} /> Regenerate</Button>
                <Button variant="secondary" disabled={!selectedDraft} onClick={() => saveDraft("SAVED")}><Save size={16} /> Save</Button>
                <Button variant="secondary" disabled={!messagePreview} onClick={copyDraft}><Clipboard size={16} /> Copy</Button>
                <Button disabled={!selectedDraft || !messagePreview} onClick={() => saveDraft("SENT")}><Send size={16} /> Mark sent</Button>
                <Button disabled={form.type !== "EMAIL" || !messagePreview || sending} onClick={() => setConfirmSend(true)}><Send size={16} /> {sending ? "Sending..." : "Send email"}</Button>
              </div>
            </div>

            <div className="mb-5 grid gap-4 lg:grid-cols-[1fr_280px]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Contact info</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {contactRows(selectedLead).map(([label, value, Icon]) => (
                    <button key={label} onClick={() => copyContact(value)} className="rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:bg-slate-100">
                      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400"><Icon size={14} /> {label}</p>
                      <p className="mt-1 truncate text-sm font-medium text-slate-800">{value}</p>
                    </button>
                  ))}
                  {!contactRows(selectedLead).length && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500 sm:col-span-2">No contact details captured yet.</p>}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-white">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400"><Plug size={15} /> Connectors</h3>
                <div className="space-y-2 text-sm">
                  <div className="rounded-xl bg-white/10 p-3">
                    <p className="font-semibold">Email connector</p>
                    <p className="mt-1 text-slate-400">{gmailReady ? `Gmail connected: ${gmailSender.email}` : "Connect ociastudios@gmail.com in Email Settings."}</p>
                  </div>
                  <div className="rounded-xl bg-white/10 p-3">
                    <p className="font-semibold">LinkedIn connector</p>
                    <p className="mt-1 text-slate-400">Stopped here for now. LinkedIn sending is not implemented.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-5 inline-flex rounded-2xl bg-slate-100 p-1">
              <button onClick={() => setActiveTab("edit")} className={`rounded-xl px-4 py-2 text-sm font-semibold ${activeTab === "edit" ? "bg-white shadow-sm" : "text-slate-500"}`}>Edit</button>
              <button onClick={() => setActiveTab("preview")} className={`rounded-xl px-4 py-2 text-sm font-semibold ${activeTab === "preview" ? "bg-white shadow-sm" : "text-slate-500"}`}><Eye size={15} className="mr-1 inline" /> Preview</button>
            </div>

            {activeTab === "edit" ? (
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
                    {statuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
                  </Select>
                </label>
                {form.type === "EMAIL" && (
                  <>
                    <label>
                      <span className="mb-1.5 block text-sm font-medium">Recipient email</span>
                      <Input value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="owner@company.com" />
                    </label>
                    <label>
                      <span className="mb-1.5 block text-sm font-medium">Subject</span>
                      <Input value={form.subject || ""} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
                    </label>
                  </>
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
            ) : (
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">Recipient preview</p>
                    <p className="mt-1 font-semibold text-slate-950">{selectedLead?.company || "No recipient selected"}</p>
                  </div>
                  <Badge className="bg-slate-100 text-slate-700 ring-slate-200">{outreachTypes[form.type]}</Badge>
                </div>
                {form.type === "EMAIL" && form.subject && <p className="mb-4 rounded-2xl bg-white p-3 text-sm font-semibold">Subject: {form.subject}</p>}
                {form.type === "EMAIL" && <p className="mb-4 rounded-2xl bg-white p-3 text-sm">To: <span className="font-semibold">{recipientEmail || "No recipient"}</span></p>}
                <pre className="min-h-80 whitespace-pre-wrap rounded-2xl bg-white p-5 text-sm leading-6 text-slate-800">{messagePreview || "Generate or open a draft to preview the final recipient-facing message."}</pre>
              </div>
            )}

            <div className="mt-5 flex justify-between">
              <Button variant="ghost" className="text-rose-600 hover:bg-rose-50" disabled={!selectedDraft} onClick={() => deleteDraft()}><Trash2 size={16} /> Delete draft</Button>
              <Button variant="secondary" disabled={!selectedDraft || !messagePreview} onClick={() => setActiveTab("preview")}><Eye size={16} /> Preview before sending</Button>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold">Drafts for this lead</h2>
              <div className="space-y-2">
                {leadDrafts.map((draft) => (
                  <div key={draft.id} className={`flex items-start gap-2 rounded-2xl border p-3 ${selectedDraft?.id === draft.id ? "border-slate-950 bg-slate-50" : "border-slate-200"}`}>
                    <button onClick={() => openDraft(draft)} className="min-w-0 flex-1 text-left">
                      <p className="font-semibold">{outreachTypes[draft.type]}</p>
                      <p className="line-clamp-2 text-sm text-slate-500">{draft.subject || draft.opener || draft.fullMessage || "Empty draft"}</p>
                      <p className="mt-2 text-xs text-slate-400">{draft.status} · {formatDate(draft.updatedAt)}</p>
                    </button>
                    <button onClick={() => deleteDraft(draft)} className="rounded-xl p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete draft">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                {selectedLead && !leadDrafts.length && <p className="rounded-2xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">No drafts for this lead yet.</p>}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold">Recent drafts</h2>
              <div className="max-h-[430px] space-y-2 overflow-auto pr-1">
                {drafts.map((draft) => (
                  <div key={draft.id} className="flex items-start gap-2 rounded-2xl border border-slate-200 p-3">
                    <button onClick={() => openDraft(draft)} className="min-w-0 flex-1 text-left">
                      <p className="truncate text-sm font-semibold">{draft.lead?.company}</p>
                      <p className="text-xs text-slate-500">{outreachTypes[draft.type]} · {draft.status}</p>
                    </button>
                    <button onClick={() => deleteDraft(draft)} className="rounded-xl p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete draft">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                {!drafts.length && <p className="text-sm text-slate-500">No outreach drafts yet.</p>}
              </div>
            </div>
          </div>
        </section>
      </div>

      {confirmSend && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-glow">
            <h2 className="text-xl font-semibold">Send this email?</h2>
            <p className="mt-2 text-sm text-slate-500">This will send from the connected Gmail account, log the send, and move the lead to Sent.</p>
            <div className="mt-5 space-y-3 rounded-2xl bg-slate-50 p-4 text-sm">
              <p><span className="font-semibold">From:</span> {gmailSender?.email || "Gmail not connected"}</p>
              <p><span className="font-semibold">To:</span> {recipientEmail || "No recipient"}</p>
              <p><span className="font-semibold">Subject:</span> {form.subject || "No subject"}</p>
            </div>
            <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap rounded-2xl border border-slate-200 p-4 text-sm">{emailBody}</pre>
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setConfirmSend(false)}>Cancel</Button>
              <Button onClick={sendEmail} disabled={sending}>{sending ? "Sending..." : "Confirm send"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
