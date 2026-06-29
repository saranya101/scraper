import { AlertTriangle, CheckCircle, ChevronLeft, ChevronRight, Clipboard, Loader2, Play, RefreshCw, RotateCcw, Send, SkipForward, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge } from "../components/ui/Badge.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Input, Select, Textarea } from "../components/ui/Input.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useToast } from "../hooks/useToast.jsx";
import { api } from "../services/api.js";
import { domain, priorities } from "../utils/format.js";

const workflowLabels = {
  NOT_ANALYSED: "Not Analysed",
  ANALYSING: "Analysing",
  GENERATING_EMAIL: "Generating Email",
  NEEDS_REVIEW: "Needs Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  NO_SUITABLE_ANGLE: "No Suitable Angle"
};

const workflowClasses = {
  NOT_ANALYSED: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700",
  ANALYSING: "bg-blue-100 text-blue-800 ring-blue-200 dark:bg-blue-950/60 dark:text-blue-100 dark:ring-blue-800",
  GENERATING_EMAIL: "bg-violet-100 text-violet-800 ring-violet-200 dark:bg-violet-950/60 dark:text-violet-100 dark:ring-violet-800",
  NEEDS_REVIEW: "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-100 dark:ring-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-100 dark:ring-emerald-800",
  REJECTED: "bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-100 dark:ring-rose-800",
  NO_SUITABLE_ANGLE: "bg-orange-100 text-orange-800 ring-orange-200 dark:bg-orange-950/60 dark:text-orange-100 dark:ring-orange-800"
};

const statusFilters = [
  ["", "All statuses"],
  ["NOT_ANALYSED", "Pending"],
  ["APPROVED", "Approved"],
  ["REJECTED", "Rejected"],
  ["NO_SUITABLE_ANGLE", "No Angle"],
  ["NEEDS_REVIEW", "Needs Review"]
];

const defaultTemplate = {
  greetingTemplate: 'Hi {{contact.firstName || "there"}},',
  openingLineTemplate: "",
  closingQuestionTemplate: "",
  signOffTemplate: "Thanks,",
  signatureTemplate: "{{sender.name}}\n{{sender.title}}\n{{sender.company}}"
};

const card = "rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";
const soft = "rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60";
const textMuted = "text-slate-500 dark:text-slate-400";

function pipelineState(lead) {
  return lead?.pipelineWorkflow || lead?.scanEvidence?.outreachPipeline || { status: "NOT_ANALYSED", label: "Not Analysed" };
}

function statusBadge(status) {
  return <Badge className={workflowClasses[status] || workflowClasses.NOT_ANALYSED}>{workflowLabels[status] || status}</Badge>;
}

function cleanGeneratedBody(body = "") {
  let text = String(body || "").replace(/\r/g, "").trim();
  text = text.replace(/^hi\s+[^,\n]+,\s*/i, "").trim();
  text = text.replace(/^hello\s+[^,\n]+,\s*/i, "").trim();
  text = text.split(/\n\s*thanks,?\s*\n/i)[0].trim();
  text = text.replace(/(?:^|\s|\n)thanks,?[\s\S]*$/i, "").trim();
  text = text.replace(/(?:^|\s|\n)best,?[\s\S]*$/i, "").trim();
  return text.trim();
}

function emailPrefix(email = "") {
  return String(email || "").split("@")[0] || "";
}

function composerSender(profile, account, persona = {}) {
  if (persona?.enabled) {
    const email = persona.assistantEmail || account?.email || profile?.senderEmail || profile?.email || "";
    return {
      name: persona.assistantName || account?.name || account?.username || emailPrefix(email),
      email,
      title: persona.assistantTitle || "",
      company: persona.companyName || ""
    };
  }
  const email = account?.email || profile?.senderEmail || profile?.email || "";
  return {
    name: profile?.senderName || profile?.name || account?.name || account?.username || emailPrefix(email),
    email,
    title: profile?.senderTitle || "",
    company: profile?.companyName || ""
  };
}

function contactEmail(lead) {
  return lead?.ownerEmail || lead?.generalEmail || lead?.contactEmail || "";
}

function firstName(lead) {
  return lead?.contactFirstName || lead?.ownerName?.split?.(/\s+/)?.[0] || "";
}

function selectedService(lead) {
  return lead?.serviceOpportunities?.[0]?.service?.name || "No recommended service";
}

function resultFromLead(lead) {
  return pipelineState(lead)?.result || null;
}

function confidenceLabel(value) {
  if (value == null) return "No confidence yet";
  return `${Math.round(Number(value || 0) * 100)}% confidence`;
}

function renderTemplate(template = "", context = {}) {
  return String(template || "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expression) => {
    const [path, fallback] = expression.split("||").map((part) => part.trim());
    const value = path.split(".").reduce((acc, key) => acc?.[key], context);
    if (value) return value;
    if (fallback) return fallback.replace(/^["']|["']$/g, "");
    return "";
  }).replace(/[ \t]+\n/g, "\n").trim();
}

function assembleEmail({ draft, sender, lead, template, observation }) {
  const context = {
    contact: { firstName: firstName(lead), name: lead?.ownerName || "" },
    company: { name: lead?.company || "", website: lead?.website || "" },
    sender,
    industry: lead?.industryRef?.name || lead?.industry || "",
    observation: { category: observation?.category || "" }
  };
  const activeTemplate = { ...defaultTemplate, ...(template || {}) };
  return [
    renderTemplate(activeTemplate.greetingTemplate, context),
    renderTemplate(activeTemplate.openingLineTemplate, context),
    String(draft.body || "").trim(),
    renderTemplate(activeTemplate.closingQuestionTemplate, context),
    renderTemplate(activeTemplate.signOffTemplate, context),
    renderTemplate(activeTemplate.signatureTemplate, context)
  ].map((part) => String(part || "").trim()).filter(Boolean).join("\n\n");
}

export default function OutreachPage() {
  const { push } = useToast();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const cancelBatchRef = useRef(false);
  const leadRefs = useRef({});
  const [catalog, setCatalog] = useState({ industries: [], services: [] });
  const [senderProfile, setSenderProfile] = useState(null);
  const [outreachPersona, setOutreachPersona] = useState(null);
  const [emailTemplate, setEmailTemplate] = useState(defaultTemplate);
  const [emailAccounts, setEmailAccounts] = useState([]);
  const [leads, setLeads] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [pipelineResult, setPipelineResult] = useState(null);
  const [filters, setFilters] = useState({ search: "", industryId: "", serviceId: "", pipelineWorkflowStatus: "", highConfidence: "", needsReview: "" });
  const [loading, setLoading] = useState(true);
  const [runningLeadId, setRunningLeadId] = useState("");
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draft, setDraft] = useState({ fromName: "", fromEmail: "", toEmail: "", subject: "", body: "" });
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllText, setDeleteAllText] = useState("");
  const [deletingAll, setDeletingAll] = useState(false);
  const [batch, setBatch] = useState(null);

  const selectedLead = useMemo(() => leads.find((lead) => lead.id === selectedLeadId) || leads[0] || null, [leads, selectedLeadId]);
  const currentState = pipelineState(selectedLead);
  const currentResult = pipelineResult || resultFromLead(selectedLead);
  const qualityGate = currentResult?.qualityGate || currentState?.qualityGate || null;
  const observation = currentResult?.selectedObservation || currentState?.selectedObservation || null;
  const gmailSender = emailAccounts.find((account) => account.provider === "GOOGLE");
  const gmailReady = Boolean(gmailSender?.configured && gmailSender?.active);
  const activeSender = composerSender(senderProfile, gmailSender, outreachPersona);
  const draftSender = { ...activeSender, name: draft.fromName, email: draft.fromEmail };
  const finalBody = assembleEmail({ draft, sender: draftSender, lead: selectedLead, template: emailTemplate, observation });
  const fullEmail = draft.subject ? `Subject: ${draft.subject}\n\n${finalBody}` : finalBody;

  const params = useMemo(() => {
    const next = { limit: 100 };
    if (filters.industryId) next.industryId = filters.industryId;
    if (filters.serviceId) next.serviceId = filters.serviceId;
    if (filters.pipelineWorkflowStatus) next.pipelineWorkflowStatus = filters.pipelineWorkflowStatus;
    if (filters.highConfidence) next.highConfidence = "true";
    if (filters.needsReview) next.needsReview = "true";
    return next;
  }, [filters]);

  const visibleLeads = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    if (!search) return leads;
    return leads.filter((lead) =>
      [lead.company, lead.website, lead.industry, lead.industryRef?.name, contactEmail(lead)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search))
    );
  }, [leads, filters.search]);

  async function loadData() {
    setLoading(true);
    try {
      const [queueRes, catalogRes, settingsRes, accountsRes] = await Promise.all([
        api.get("/outreach/queue", { params }),
        api.get("/leads/meta/catalog"),
        api.get("/settings"),
        api.get("/email/accounts")
      ]);
      const requestedLeadId = searchParams.get("leadId");
      let nextLeads = queueRes.data || [];
      if (requestedLeadId && !nextLeads.some((lead) => lead.id === requestedLeadId)) {
        const leadRes = await api.get(`/leads/${requestedLeadId}`).catch(() => null);
        if (leadRes?.data) nextLeads = [leadRes.data, ...nextLeads];
      }
      setLeads(nextLeads);
      setCatalog(catalogRes.data || { industries: [], services: [] });
      setSenderProfile(settingsRes.data?.profile || null);
      setOutreachPersona(settingsRes.data?.outreachPersona || null);
      setEmailTemplate({ ...defaultTemplate, ...(settingsRes.data?.outreachEmailTemplate || {}) });
      setEmailAccounts(accountsRes.data || []);
      if (requestedLeadId && nextLeads.some((lead) => lead.id === requestedLeadId)) setSelectedLeadId(requestedLeadId);
      else if (!selectedLeadId && nextLeads[0]) setSelectedLeadId(nextLeads[0].id);
    } catch (error) {
      push(error.response?.data?.message || "Could not load outreach pipeline", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => loadData(), 200);
    return () => clearTimeout(timer);
  }, [JSON.stringify(params)]);

  useEffect(() => {
    const requestedLeadId = searchParams.get("leadId");
    if (requestedLeadId && leads.some((lead) => lead.id === requestedLeadId)) setSelectedLeadId(requestedLeadId);
  }, [searchParams, leads.length]);

  useEffect(() => {
    if (!selectedLead) return;
    setPipelineResult(resultFromLead(selectedLead));
    const state = pipelineState(selectedLead);
    const savedDraft = state?.editedDraft;
    const sourceEmail = state?.result?.email || state?.email || {};
    const to = savedDraft?.toEmail || contactEmail(selectedLead);
    setDraft({
      fromName: savedDraft?.fromName || activeSender.name || "",
      fromEmail: savedDraft?.fromEmail || activeSender.email || "",
      toEmail: to || "",
      subject: savedDraft?.subject || sourceEmail.subject || "",
      body: savedDraft?.body || cleanGeneratedBody(sourceEmail.body || "")
    });
  }, [selectedLead?.id, senderProfile?.id, gmailSender?.email, outreachPersona?.enabled, outreachPersona?.assistantName, outreachPersona?.assistantEmail]);

  useEffect(() => {
    if (!selectedLead?.id) return;
    leadRefs.current[selectedLead.id]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selectedLead?.id]);

  function setLeadWorkflow(leadId, workflow) {
    setLeads((current) => current.map((lead) => lead.id === leadId ? {
      ...lead,
      pipelineWorkflow: workflow,
      pipelineWorkflowStatus: workflow?.status,
      pipelineConfidence: workflow?.confidence,
      pipelineQualityScore: workflow?.qualityScore,
      pipelineObservationCategory: workflow?.observationCategory
    } : lead));
  }

  function selectLead(lead) {
    setSelectedLeadId(lead.id);
    setPipelineResult(resultFromLead(lead));
  }

  function setComposerFromResult(lead, result) {
    setDraft({
      fromName: activeSender.name || "",
      fromEmail: activeSender.email || "",
      toEmail: contactEmail(lead) || "",
      subject: result?.email?.subject || "",
      body: cleanGeneratedBody(result?.email?.body || "")
    });
  }

  function moveLead(direction) {
    const index = visibleLeads.findIndex((lead) => lead.id === selectedLead?.id);
    const next = visibleLeads[index + direction];
    if (next) selectLead(next);
  }

  async function runPipeline(lead = selectedLead) {
    if (!lead) return push("Select a lead first", "error");
    setRunningLeadId(lead.id);
    setLeadWorkflow(lead.id, { ...pipelineState(lead), status: "ANALYSING", label: "Analysing" });
    const generatingTimer = setTimeout(() => {
      setLeadWorkflow(lead.id, { ...pipelineState(lead), status: "GENERATING_EMAIL", label: "Generating Email" });
    }, 900);
    try {
      const { data } = await api.post("/outreach/pipeline", {
        leadId: lead.id,
        company: { name: lead.company, website: lead.website },
        industry: lead.industryRef?.name || lead.industry || "",
        sender: { name: activeSender.name, title: activeSender.title, company: activeSender.company }
      });
      setLeadWorkflow(lead.id, data.pipelineState || { status: data.status === "approved" ? "APPROVED" : data.status === "no_suitable_angle" ? "NO_SUITABLE_ANGLE" : "NEEDS_REVIEW", result: data });
      if (lead.id === selectedLead?.id) {
        setPipelineResult(data);
        setComposerFromResult(lead, data);
      }
      if (data.status === "approved") push("Email approved for review");
      if (data.status === "no_suitable_angle") push("No suitable angle found", "error");
      return data;
    } catch (error) {
      setLeadWorkflow(lead.id, { ...pipelineState(lead), status: "REJECTED", label: "Rejected", qualityGate: { reason: error.response?.data?.message || "Pipeline failed" } });
      push(error.response?.data?.message || "Pipeline failed", "error");
      throw error;
    } finally {
      clearTimeout(generatingTimer);
      setRunningLeadId("");
    }
  }

  async function saveDraft() {
    if (!selectedLead) return push("Select a lead first", "error");
    setSavingDraft(true);
    try {
      const { data } = await api.post("/outreach/pipeline/draft", {
        leadId: selectedLead.id,
        draft: { ...draft, fullEmail: finalBody }
      });
      setLeadWorkflow(selectedLead.id, data);
      push("Draft saved");
      return data;
    } catch (error) {
      push(error.response?.data?.message || "Could not save draft", "error");
      return null;
    } finally {
      setSavingDraft(false);
    }
  }

  async function decide(decision) {
    if (!selectedLead) return;
    const { data } = await api.post("/outreach/pipeline/decision", { leadId: selectedLead.id, decision });
    setLeadWorkflow(selectedLead.id, data);
    push(decision === "APPROVED" ? "Email approved" : "Email rejected");
  }

  async function overrideApprove() {
    const saved = await saveDraft();
    if (saved) await decide("APPROVED");
  }

  async function resetLeads(mode) {
    if (mode === "all" && !confirm("Reset pipeline analysis for all leads? Leads will not be deleted.")) return;
    const leadIds = mode === "current" ? [selectedLead?.id].filter(Boolean) : selectedIds;
    if (mode !== "all" && !leadIds.length) return push("Select at least one lead to reset", "error");
    await api.post("/outreach/pipeline/reset", { leadIds, all: mode === "all" });
    push(mode === "all" ? "All pipeline state reset" : "Pipeline state reset");
    setPipelineResult(null);
    setSelectedIds([]);
    await loadData();
  }

  async function copyText(value, label) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    push(label);
  }

  async function sendEmail() {
    if (!selectedLead) return push("Select a lead first", "error");
    if (!gmailReady) return push("Connect Gmail before sending", "error");
    if (!draft.toEmail) return push("Add a recipient email first", "error");
    if (!draft.subject) return push("Add a subject first", "error");
    if (!draft.body.trim()) return push("Add an email body first", "error");
    setSending(true);
    try {
      const saved = await saveDraft();
      if (!saved) return;
      const { data } = await api.post("/email/send", {
        leadId: selectedLead.id,
        toEmail: draft.toEmail,
        subject: draft.subject,
        body: finalBody
      });
      if (data.status === "SENT") {
        push("Email sent");
        await loadData();
        moveLead(1);
      } else {
        push(data.errorMessage || "Email send failed", "error");
      }
    } catch (error) {
      push(error.response?.data?.message || "Email send failed", "error");
    } finally {
      setSending(false);
    }
  }

  async function sendTestEmail() {
    if (!selectedLead) return push("Select a lead first", "error");
    if (!testEmail) return push("Add a test email first", "error");
    if (!draft.subject) return push("Add a subject first", "error");
    if (!draft.body.trim()) return push("Add an email body first", "error");
    setSendingTest(true);
    try {
      const saved = await saveDraft();
      if (!saved) return;
      const { data } = await api.post("/email/test", {
        leadId: selectedLead.id,
        fromName: draft.fromName,
        fromEmail: draft.fromEmail,
        toEmail: testEmail,
        subject: draft.subject,
        body: finalBody
      });
      if (data.status === "SENT") push(`Test email sent to ${testEmail}`);
      else push(data.errorMessage || "Test email failed", "error");
    } catch (error) {
      push(error.response?.data?.message || "Test email failed", "error");
    } finally {
      setSendingTest(false);
    }
  }

  async function deleteAllLeads() {
    if (deleteAllText !== "DELETE ALL LEADS") return push("Type DELETE ALL LEADS to confirm", "error");
    setDeletingAll(true);
    try {
      const { data } = await api.delete("/leads/all", { data: { confirmation: deleteAllText } });
      push(`Deleted ${data.deleted || 0} leads`);
      setDeleteAllOpen(false);
      setDeleteAllText("");
      setSelectedLeadId("");
      setPipelineResult(null);
      setSelectedIds([]);
      await loadData();
    } catch (error) {
      push(error.response?.data?.message || "Delete all leads failed", "error");
    } finally {
      setDeletingAll(false);
    }
  }

  async function runBatch(source = "selected") {
    const targets = source === "all" ? visibleLeads : visibleLeads.filter((lead) => selectedIds.includes(lead.id));
    if (!targets.length) return push("Select at least one lead", "error");
    cancelBatchRef.current = false;
    const progress = { total: targets.length, completed: 0, approved: 0, rejected: 0, skipped: 0, errors: 0, current: "" };
    setBatch({ ...progress, running: true });
    for (const lead of targets) {
      if (cancelBatchRef.current) {
        progress.skipped += targets.length - progress.completed;
        break;
      }
      progress.current = lead.company;
      setBatch({ ...progress, running: true });
      try {
        const result = await runPipeline(lead);
        if (result.status === "approved") progress.approved += 1;
        else progress.rejected += 1;
      } catch {
        progress.errors += 1;
      }
      progress.completed += 1;
      setBatch({ ...progress, running: true });
    }
    setBatch({ ...progress, running: false, current: "" });
    push("Batch pipeline finished");
  }

  function toggleSelected(leadId) {
    setSelectedIds((current) => current.includes(leadId) ? current.filter((id) => id !== leadId) : [...current, leadId]);
  }

  return (
    <div className="space-y-5 text-slate-950 dark:text-slate-50">
      <div className="flex flex-col gap-4 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">Outreach Pipeline</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Analyze, review, send</h1>
          <p className={`mt-2 max-w-2xl ${textMuted}`}>A focused CRM workflow for reviewing leads, polishing the message, and sending from one clean screen.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!selectedLead || Boolean(runningLeadId)} onClick={() => runPipeline()}><Play size={16} /> {runningLeadId === selectedLead?.id ? "Analysing..." : "Analyze"}</Button>
          <Button variant="secondary" disabled={!selectedLead} onClick={() => resetLeads("current")}><RotateCcw size={16} /> Reset Current</Button>
          {user?.role === "ADMIN" && <Button variant="danger" onClick={() => setDeleteAllOpen(true)}><AlertTriangle size={16} /> Delete All Leads</Button>}
        </div>
      </div>

      {batch && (
        <div className={`${card} p-4`}>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-semibold">Batch progress</h2>
              <p className={`mt-1 text-sm ${textMuted}`}>{batch.running ? `Processing ${batch.current || "lead"}...` : "Batch complete"}</p>
            </div>
            {batch.running && <Button variant="secondary" onClick={() => { cancelBatchRef.current = true; }}>Cancel</Button>}
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full bg-slate-950 transition-all dark:bg-white" style={{ width: `${batch.total ? (batch.completed / batch.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[320px_minmax(390px,0.9fr)_minmax(520px,1.05fr)]">
        <aside className={`${card} p-4 xl:sticky xl:top-24 xl:self-start`}>
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Lead queue</h2>
            <p className={`text-sm ${textMuted}`}>{visibleLeads.length} visible · {selectedIds.length} selected</p>
          </div>
          <div className="space-y-2">
            <Input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Search leads..." />
            <div className="grid grid-cols-2 gap-2">
              <Select value={filters.pipelineWorkflowStatus} onChange={(event) => setFilters({ ...filters, pipelineWorkflowStatus: event.target.value, needsReview: "", highConfidence: "" })}>
                {statusFilters.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}
              </Select>
              <Select value={filters.industryId} onChange={(event) => setFilters({ ...filters, industryId: event.target.value })}>
                <option value="">Industry</option>
                {catalog.industries.map((industry) => <option key={industry.id} value={industry.id}>{industry.name}</option>)}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={!selectedIds.length || batch?.running} onClick={() => runBatch("selected")}>Run selected</Button>
              <Button variant="secondary" disabled={!visibleLeads.length || batch?.running} onClick={() => runBatch("all")}>Run all</Button>
            </div>
          </div>
          <div className="mt-4 max-h-[calc(100vh-330px)] min-h-96 space-y-2 overflow-auto pr-1">
            {visibleLeads.map((lead) => {
              const state = pipelineState(lead);
              return (
                <div ref={(node) => { if (node) leadRefs.current[lead.id] = node; }} key={lead.id} className={`rounded-2xl border p-3 transition ${selectedLead?.id === lead.id ? "border-slate-950 bg-slate-50 dark:border-white dark:bg-slate-800/80" : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"}`}>
                  <div className="flex gap-3">
                    <input type="checkbox" checked={selectedIds.includes(lead.id)} onChange={() => toggleSelected(lead.id)} className="mt-1" />
                    <button onClick={() => selectLead(lead)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{lead.company}</p>
                          <p className={`truncate text-sm ${textMuted}`}>{domain(lead.website)}</p>
                        </div>
                        <Badge className={priorities[lead.priority]?.className}>{priorities[lead.priority]?.label}</Badge>
                      </div>
                      <p className={`mt-2 truncate text-sm ${textMuted}`}>{lead.industryRef?.name || lead.industry || "No industry"}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {statusBadge(state.status)}
                        {state.qualityScore && <Badge className="bg-white text-slate-700 ring-slate-200 dark:bg-slate-950 dark:text-slate-200 dark:ring-slate-700">Q {state.qualityScore}/10</Badge>}
                      </div>
                    </button>
                  </div>
                </div>
              );
            })}
            {!visibleLeads.length && <p className={`rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm dark:border-slate-700 ${textMuted}`}>{loading ? "Loading leads..." : "No leads match these filters."}</p>}
          </div>
        </aside>

        <main className="space-y-5">
          <section className={`${card} p-5`}>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {statusBadge(currentState.status)}
                  {runningLeadId === selectedLead?.id && <Badge className={workflowClasses.ANALYSING}><Loader2 size={13} className="mr-1 animate-spin" /> Working</Badge>}
                </div>
                <h2 className="mt-3 text-2xl font-semibold">{selectedLead?.company || "Select a lead"}</h2>
                {selectedLead && <Link to={`/leads/${selectedLead.id}`} className={`mt-1 inline-block text-sm hover:text-slate-950 dark:hover:text-white ${textMuted}`}>{selectedLead.website}</Link>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={!selectedLead || visibleLeads[0]?.id === selectedLead?.id} onClick={() => moveLead(-1)}><ChevronLeft size={16} /> Previous</Button>
                <Button variant="secondary" disabled={!selectedLead} onClick={() => moveLead(1)}><SkipForward size={16} /> Skip</Button>
                <Button variant="secondary" disabled={!selectedLead || visibleLeads.at(-1)?.id === selectedLead?.id} onClick={() => moveLead(1)}>Next <ChevronRight size={16} /></Button>
              </div>
            </div>
            {selectedLead && (
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <InfoCard title="Business" lines={[selectedLead.industryRef?.name || selectedLead.industry || "Industry not set", selectedService(selectedLead), `${selectedLead.priority} priority`]} />
                <InfoCard title="Website" lines={[domain(selectedLead.website), selectedLead.websiteStatus || "Unknown status", selectedLead.cms ? `CMS: ${selectedLead.cms}` : "CMS not detected"]} />
                <InfoCard title="Contact" lines={[contactEmail(selectedLead) || "No email captured", selectedLead.phone || "No phone captured", selectedLead.linkedinCompany || selectedLead.instagram || "No social captured"]} />
              </div>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              <Button disabled={!selectedLead || Boolean(runningLeadId)} onClick={() => runPipeline()}><RefreshCw size={16} /> Run Pipeline Again</Button>
              <Button variant="secondary" disabled={!selectedLead || savingDraft} onClick={overrideApprove}><CheckCircle size={16} /> Override & Approve</Button>
              <Button variant="secondary" disabled={!currentResult} onClick={() => decide("REJECTED")}><XCircle size={16} /> Reject</Button>
              <Button variant="secondary" disabled={!selectedLead} onClick={() => resetLeads("current")}><RotateCcw size={16} /> Reset</Button>
            </div>
          </section>

          <Panel title="Business summary">
            <p className={`text-sm leading-6 ${textMuted}`}>{currentResult?.debug?.businessSummary || selectedLead?.scanEvidence?.businessUnderstanding?.summary || "Run the pipeline to capture the business context used for outreach."}</p>
          </Panel>

          <details className={`${card} p-5`}>
            <summary className="cursor-pointer text-lg font-semibold">Selected observation</summary>
            <div className="mt-4">
              {observation ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge className="bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700">{observation.category || "Observation"}</Badge>
                    {currentState.confidence && <Badge className="bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700">{confidenceLabel(currentState.confidence)}</Badge>}
                  </div>
                  <h3 className="font-semibold">{observation.title || observation.expected}</h3>
                  <p className={`text-sm leading-6 ${textMuted}`}>{observation.description || observation.reasoning || observation.actual}</p>
                </div>
              ) : <p className={`text-sm ${textMuted}`}>No selected observation yet.</p>}
            </div>
          </details>

          <Panel title="Quality gate">
            {qualityGate ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {qualityGate.approved ? <CheckCircle className="text-emerald-600 dark:text-emerald-300" size={18} /> : <XCircle className="text-rose-600 dark:text-rose-300" size={18} />}
                  <span className="font-semibold">{qualityGate.approved ? "Approved" : "Rejected"}</span>
                  <Badge className={qualityGate.approved ? workflowClasses.APPROVED : workflowClasses.REJECTED}>Quality {qualityGate.qualityScore}/10</Badge>
                </div>
                <p className={`text-sm leading-6 ${textMuted}`}>{qualityGate.reason}</p>
              </div>
            ) : <p className={`text-sm ${textMuted}`}>Quality Gate has not run for this lead yet.</p>}
          </Panel>

          <details className={`${card} p-5`}>
            <summary className="cursor-pointer font-semibold">Debug</summary>
            <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap rounded-2xl bg-slate-950 p-4 text-xs text-slate-100 dark:bg-black">{JSON.stringify(currentResult || currentState || {}, null, 2)}</pre>
          </details>
        </main>

        <aside className="xl:sticky xl:top-24 xl:self-start">
          <section className={`${card} overflow-hidden`}>
            <div className="border-b border-slate-200 p-5 dark:border-slate-800">
              <h2 className="text-lg font-semibold">Email composer</h2>
              <p className={`mt-1 text-sm ${textMuted}`}>AI writes the core insight. Your template controls the greeting and signature.</p>
            </div>
            <div className="space-y-4 p-5">
              {currentState.status === "REJECTED" && <Notice tone="rose">Quality gate rejected this email. Edit before sending.</Notice>}
              {currentState.status === "NO_SUITABLE_ANGLE" && <Notice tone="orange">No suitable angle was found. You can still write a manual email.</Notice>}
              {!draft.toEmail && <Notice tone="amber">No recipient email found. Add one before sending.</Notice>}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="From name"><Input value={draft.fromName} onChange={(event) => setDraft({ ...draft, fromName: event.target.value })} /></Field>
                <Field label="From email"><Input value={draft.fromEmail} onChange={(event) => setDraft({ ...draft, fromEmail: event.target.value })} /></Field>
                <Field label="To email"><Input value={draft.toEmail} onChange={(event) => setDraft({ ...draft, toEmail: event.target.value })} placeholder="recipient@company.com" /></Field>
                <Field label="Subject"><Input value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} placeholder="Small question about your website" /></Field>
              </div>

              <Field label="Body">
                <Textarea
                  className="min-h-[420px] resize-y bg-white text-[15px] leading-7 dark:bg-slate-950"
                  value={draft.body}
                  onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                  placeholder={currentState.status === "NO_SUITABLE_ANGLE" ? "Write a manual email body here..." : "Edit the generated email body..."}
                />
              </Field>

              <div className={soft + " p-4"}>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Final email preview</p>
                <div className="mt-3 space-y-1 border-b border-slate-200 pb-3 text-sm dark:border-slate-800">
                  <p><span className="font-semibold">From:</span> {draft.fromName || "Sender"} {draft.fromEmail ? `<${draft.fromEmail}>` : ""}</p>
                  <p><span className="font-semibold">To:</span> {draft.toEmail || "Recipient not set"}</p>
                  <p><span className="font-semibold">Subject:</span> {draft.subject || "No subject"}</p>
                </div>
                <pre className="mt-4 whitespace-pre-wrap font-sans text-sm leading-7 text-slate-800 dark:text-slate-100">{finalBody || "Your final email preview will appear here."}</pre>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="secondary" disabled={savingDraft} onClick={saveDraft}><Clipboard size={16} /> {savingDraft ? "Saving..." : "Save Draft"}</Button>
                <Button variant="secondary" disabled={!draft.subject && !draft.body} onClick={() => copyText(fullEmail, "Email copied")}><Clipboard size={16} /> Copy Email</Button>
                <Button variant="secondary" disabled={!selectedLead || Boolean(runningLeadId)} onClick={() => runPipeline()}><RefreshCw size={16} /> Regenerate</Button>
                <Button disabled={sending || !draft.subject || !draft.body} onClick={sendEmail}><Send size={16} /> {currentState.status === "APPROVED" ? "Send" : "Send Anyway"}</Button>
              </div>

              <div className={soft + " p-3"}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Send test email</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="your@email.com" />
                  <Button variant="secondary" disabled={sendingTest || !draft.subject || !draft.body} onClick={sendTestEmail}>{sendingTest ? "Sending..." : "Send Test"}</Button>
                </div>
              </div>
            </div>
          </section>
        </aside>
      </div>

      {deleteAllOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-glow dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-200">
                <AlertTriangle size={18} />
              </div>
              <div>
                <h2 className="text-xl font-semibold">Delete all leads?</h2>
                <p className={`mt-2 text-sm leading-6 ${textMuted}`}>This permanently deletes lead records, pipeline state, emails, observations, notes, and related lead data. This cannot be undone.</p>
              </div>
            </div>
            <Field label="Type DELETE ALL LEADS to confirm">
              <Input value={deleteAllText} onChange={(event) => setDeleteAllText(event.target.value)} placeholder="DELETE ALL LEADS" />
            </Field>
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setDeleteAllOpen(false)}>Cancel</Button>
              <Button variant="danger" disabled={deleteAllText !== "DELETE ALL LEADS" || deletingAll} onClick={deleteAllLeads}>{deletingAll ? "Deleting..." : "Delete All Leads"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
      {children}
    </label>
  );
}

function InfoCard({ title, lines }) {
  return (
    <div className={soft + " p-4"}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <div className="mt-3 space-y-1">
        {lines.map((line) => <p key={line} className="truncate text-sm text-slate-700 dark:text-slate-200">{line}</p>)}
      </div>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <section className={card + " p-5"}>
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Notice({ tone, children }) {
  const classes = {
    rose: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-100",
    orange: "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950/50 dark:text-orange-100",
    amber: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100"
  };
  return <div className={`rounded-2xl border p-4 text-sm ${classes[tone]}`}>{children}</div>;
}
