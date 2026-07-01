import { AlertTriangle, ArrowUpRight, CheckCircle, ChevronLeft, ChevronRight, Clipboard, FileText, Loader2, Play, RefreshCw, RotateCcw, Send, SkipForward, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ReportServiceSelector from "../components/ReportServiceSelector.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { Button } from "../components/ui/Button.jsx";
import { DEFAULT_REPORT_SERVICE_IDS, REPORT_SERVICE_OPTIONS } from "../constants/reportServices.js";
import { Input, Select, Textarea } from "../components/ui/Input.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useToast } from "../hooks/useToast.jsx";
import { api } from "../services/api.js";
import { domain, formatDate, priorities } from "../utils/format.js";

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

const emailStatusFilters = [
  ["", "All email states"],
  ["NOT_SENT", "Email Not Sent"],
  ["READY_TO_SEND", "Approved"],
  ["SENT", "Sent"],
  ["REPLIED", "Replied"],
  ["BOUNCED", "Bounced"],
  ["REJECTED", "Failed / rejected"]
];

const contactEmailFilters = [
  ["", "All To emails"],
  ["true", "Has To email"]
];

const replyTypeFilters = [
  ["", "All reply types"],
  ["INTERESTED", "Interested"],
  ["MAYBE_LATER", "Maybe later"],
  ["NOT_INTERESTED", "Not interested"],
  ["ASKED_FOR_PRICE", "Asked for price"],
  ["ASKED_FOR_MORE_INFO", "Asked for more info"],
  ["WRONG_CONTACT", "Wrong contact"],
  ["AUTO_REPLY", "Auto-reply"],
  ["OTHER", "Other"]
];

const actionFilters = [
  ["", "All actions"],
  ["needs_action", "Needs action"],
  ["no_action", "No action needed"],
  ["do_not_contact", "Do not contact"]
];

const followUpFilters = [
  ["", "All follow-ups"],
  ["due", "Follow-up due"],
  ["scheduled", "Scheduled"],
  ["completed", "Completed"],
  ["stopped", "Stopped"],
  ["failed", "Failed"]
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

function normalizeForComparison(value = "") {
  return String(value || "").replace(/\r/g, "").replace(/\s+/g, " ").trim();
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

function cleanAwkwardCompanyPhrases(text = "", company = "") {
  let next = String(text || "");
  const name = String(company || "").trim();
  if (name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (/^the\s+/i.test(name)) {
      next = next.replace(new RegExp(`\\bthe\\s+${escaped}\\b`, "gi"), name);
    }
    next = next.replace(new RegExp(`\\b(the\\s+){2,}${escaped}\\b`, "gi"), `the ${name}`);
  }
  return next;
}

function normalizeEmailBody(body = "", company = "") {
  return cleanAwkwardCompanyPhrases(body, company)
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function naturalJoin(items = []) {
  const list = items.filter(Boolean);
  if (!list.length) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list.at(-1)}`;
}

function normalizedServiceIds(items = []) {
  return [...new Set(items.filter(Boolean))].sort();
}

function sameServiceSelection(left = [], right = []) {
  const a = normalizedServiceIds(left);
  const b = normalizedServiceIds(right);
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function selectedServiceIdsForLead(lead) {
  return lead?.selectedReportServices?.length
    ? lead.selectedReportServices
    : lead?.pipelineWorkflow?.selectedReportServices?.length
      ? lead.pipelineWorkflow.selectedReportServices
      : [];
}

function selectedServiceLabelsForLead(lead) {
  const analyzed = Array.isArray(lead?.analyzedServices) ? lead.analyzedServices : [];
  const selected = new Set(selectedServiceIdsForLead(lead));
  return analyzed
    .filter((item) => selected.has(item.serviceId))
    .map((item) => item.serviceLabel)
    .filter(Boolean);
}

function leadEmailStatus(lead) {
  if (lead?.emailStatus === "BOUNCED" || lead?.bouncedAt || lead?.pipelineStage === "BOUNCED") return "BOUNCED";
  if (lead?.emailStatus === "REPLIED" || lead?.repliedAt || ["REPLIED", "MEETING", "PROPOSAL", "WON", "LOST"].includes(lead?.pipelineStage)) return "REPLIED";
  if (lead?.emailStatus === "SENT" || lead?.lastEmailSentAt || lead?.pipelineStage === "SENT") return "SENT";
  if (lead?.emailStatus === "READY_TO_SEND") return "READY_TO_SEND";
  if (lead?.emailStatus === "REJECTED") return "REJECTED";
  return "NOT_SENT";
}

function replyClassificationBadge(lead) {
  const type = String(lead?.replyClassification || "");
  if (!type) return null;
  const map = {
    INTERESTED: ["Interested", "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-100 dark:ring-emerald-800"],
    MAYBE_LATER: ["Maybe later", "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-100 dark:ring-amber-800"],
    NOT_INTERESTED: ["Not interested", "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700"],
    ASKED_FOR_PRICE: ["Asked for price", "bg-cyan-100 text-cyan-800 ring-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-100 dark:ring-cyan-800"],
    ASKED_FOR_MORE_INFO: ["Asked for more info", "bg-blue-100 text-blue-800 ring-blue-200 dark:bg-blue-950/60 dark:text-blue-100 dark:ring-blue-800"],
    WRONG_CONTACT: ["Wrong contact", "bg-orange-100 text-orange-800 ring-orange-200 dark:bg-orange-950/60 dark:text-orange-100 dark:ring-orange-800"],
    AUTO_REPLY: ["Auto-reply", "bg-violet-100 text-violet-800 ring-violet-200 dark:bg-violet-950/60 dark:text-violet-100 dark:ring-violet-800"],
    OTHER: ["Other reply", "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700"]
  };
  const [label, className] = map[type] || [type.toLowerCase().replaceAll("_", " "), "bg-slate-100 text-slate-700 ring-slate-200"];
  return { label, className };
}

function gmailReplyUrl(threadId = "", messageId = "") {
  if (threadId && messageId) return `https://mail.google.com/mail/u/0/#all/${threadId}/${messageId}`;
  if (threadId) return `https://mail.google.com/mail/u/0/#all/${threadId}`;
  return "";
}

function followUpState(lead) {
  const status = String(lead?.followUpStatus || "NOT_STARTED");
  const nextAt = lead?.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : null;
  const isDue = nextAt && nextAt <= new Date() && !["COMPLETED", "STOPPED"].includes(status) && !lead?.repliedAt;
  if (isDue) {
    return {
      label: `Follow-up ${Number(lead?.followUpStep || 0) >= 1 ? "2 due" : "1 due"}`,
      className: "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-100 dark:ring-amber-800"
    };
  }
  if (status === "SCHEDULED") return { label: "Follow-up scheduled", className: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700" };
  if (status === "FOLLOW_UP_1_SENT") return { label: "Follow-up 1 sent", className: "bg-blue-100 text-blue-800 ring-blue-200 dark:bg-blue-950/60 dark:text-blue-100 dark:ring-blue-800" };
  if (status === "COMPLETED") return { label: "Follow-up completed", className: "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-100 dark:ring-emerald-800" };
  if (status === "STOPPED") return { label: "Follow-up stopped", className: "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-100 dark:ring-emerald-800" };
  if (status === "FAILED") return { label: "Follow-up failed", className: "bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-100 dark:ring-rose-800" };
  return { label: "No follow-up", className: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700" };
}

function overallLeadBatchStage(progress) {
  if (!progress) return "";
  if (progress.status === "failed") return "Failed";
  if (progress.status === "completed") return "Completed";
  if (progress.emailStatus === "completed") return "Email sent";
  if (progress.reportStatus === "running") return "Generating PDF";
  if (progress.emailStatus === "running") return "Generating Email";
  if (progress.analysisStatus === "running") return "Analysing";
  if (progress.status === "queued") return "Queued";
  return "";
}

function reportSentence(selectedServices = []) {
  const focusAreas = naturalJoin(selectedServices.map((item) => item.label).filter(Boolean).slice(0, 3));
  return focusAreas
    ? `I attached a short website opportunity report with a few specific improvements around ${focusAreas}.`
    : "I attached a short website opportunity report with a few specific suggestions.";
}

function appendReportSentence(body = "", shouldIncludeReport = false, selectedServices = []) {
  const next = String(body || "").trim();
  if (!shouldIncludeReport) return next;
  if (/attached a short website opportunity report/i.test(next)) return next;
  return [next, reportSentence(selectedServices)].filter(Boolean).join("\n\n");
}

function assembleEmail({ draft, sender, lead, template, observation, includeReport = false, selectedServices = [] }) {
  const context = {
    contact: { firstName: firstName(lead), name: lead?.ownerName || "" },
    company: { name: lead?.company || "", website: lead?.website || "" },
    sender,
    industry: lead?.industryRef?.name || lead?.industry || "",
    observation: { category: observation?.category || "" }
  };
  const activeTemplate = { ...defaultTemplate, ...(template || {}) };
  const generatedBody = appendReportSentence(String(draft.body || "").trim(), includeReport, selectedServices);
  const body = [
    renderTemplate(activeTemplate.greetingTemplate, context),
    renderTemplate(activeTemplate.openingLineTemplate, context),
    generatedBody,
    renderTemplate(activeTemplate.closingQuestionTemplate, context),
    renderTemplate(activeTemplate.signOffTemplate, context),
    renderTemplate(activeTemplate.signatureTemplate, context)
  ].map((part) => String(part || "").trim()).filter(Boolean).join("\n\n");
  return normalizeEmailBody(body, lead?.company || "");
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
  const [filters, setFilters] = useState({ search: "", industryId: "", serviceId: "", pipelineWorkflowStatus: "", highConfidence: "", needsReview: "", emailStatus: "", hasContactEmail: "", followUpState: "", replyType: "", actionState: "" });
  const [loading, setLoading] = useState(true);
  const [runningLeadId, setRunningLeadId] = useState("");
  const [sending, setSending] = useState(false);
  const [syncingReplies, setSyncingReplies] = useState(false);
  const [replySyncProgress, setReplySyncProgress] = useState(null);
  const [singleSendProgress, setSingleSendProgress] = useState(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draft, setDraft] = useState({ fromName: "", fromEmail: "", toEmail: "", subject: "", body: "" });
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportAction, setReportAction] = useState("");
  const [reportServices, setReportServices] = useState(DEFAULT_REPORT_SERVICE_IDS);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyDraftLoading, setReplyDraftLoading] = useState(false);
  const [followUpDraftState, setFollowUpDraftState] = useState({ loading: false, saving: false, open: false, draftId: "", subject: "", body: "", type: "" });
  const [batchReportServices, setBatchReportServices] = useState(DEFAULT_REPORT_SERVICE_IDS);
  const [batchOptions, setBatchOptions] = useState({
    analyzeServicesIfMissing: true,
    generateReport: true,
    generateEmail: true,
    runQualityGate: true,
    includeAttachmentWhenSending: true
  });
  const [batchConcurrency, setBatchConcurrency] = useState(4);
  const [includeReport, setIncludeReport] = useState(true);
  const [liveQualityGate, setLiveQualityGate] = useState(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllText, setDeleteAllText] = useState("");
  const [deletingAll, setDeletingAll] = useState(false);
  const [batch, setBatch] = useState(null);
  const [batchLeadProgress, setBatchLeadProgress] = useState({});

  const selectedLead = useMemo(() => leads.find((lead) => lead.id === selectedLeadId) || leads[0] || null, [leads, selectedLeadId]);
  const currentState = pipelineState(selectedLead);
  const currentResult = pipelineResult || resultFromLead(selectedLead);
  const storedQualityGate = currentResult?.qualityGate || currentState?.qualityGate || null;
  const observation = currentResult?.selectedObservation || currentState?.selectedObservation || null;
  const gmailSender = emailAccounts.find((account) => account.provider === "GOOGLE");
  const gmailReady = Boolean(gmailSender?.configured && gmailSender?.active);
  const activeSender = composerSender(senderProfile, gmailSender, outreachPersona);
  const draftSender = { ...activeSender, name: draft.fromName, email: draft.fromEmail };
  const reportReady = Boolean(report?.canAttach);
  const serviceLabelsById = Object.fromEntries(REPORT_SERVICE_OPTIONS.map((service) => [service.id, service.label]));
  const emailSelectedServiceIds = currentResult?.emailSelectedServices || currentState?.emailSelectedServices || [];
  const previewReportServices = reportServices.map((serviceId) => ({ id: serviceId, label: serviceLabelsById[serviceId] || serviceId }));
  const approvedReportServiceIds = (report?.selectedServices || []).map((item) => item.id).filter(Boolean);
  const approvedReportFocus = naturalJoin((report?.selectedServices || []).map((item) => item.label).filter(Boolean));
  const finalBody = assembleEmail({
    draft,
    sender: draftSender,
    lead: selectedLead,
    template: emailTemplate,
    observation,
    includeReport: includeReport && reportReady,
    selectedServices: previewReportServices
  });
  const fullEmail = draft.subject ? `Subject: ${draft.subject}\n\n${finalBody}` : finalBody;
  const savedEmailSubject = currentState?.editedDraft?.subject || currentResult?.email?.subject || currentState?.email?.subject || "";
  const savedEmailBody = currentState?.editedDraft?.fullEmail || currentState?.editedDraft?.body || currentResult?.email?.body || currentState?.email?.body || "";
  const hasUnsavedEmailChanges = Boolean(
    normalizeForComparison(draft.subject) !== normalizeForComparison(savedEmailSubject) ||
    normalizeForComparison(finalBody) !== normalizeForComparison(savedEmailBody)
  );
  const qualityGate = storedQualityGate || null;
  const previewQualityGate = hasUnsavedEmailChanges ? liveQualityGate : null;
  const selectedReportFocus = naturalJoin(reportServices.map((serviceId) => serviceLabelsById[serviceId] || serviceId));
  const emailServiceMismatch = Boolean(reportServices.length && !sameServiceSelection(emailSelectedServiceIds, reportServices));
  const reportServiceMismatch = Boolean(reportReady && approvedReportServiceIds.length && !sameServiceSelection(approvedReportServiceIds, reportServices));
  const attachmentFocusText = reportServiceMismatch
    ? `The approved PDF is still focused on ${approvedReportFocus || "older services"}. Regenerate and approve the report to match ${selectedReportFocus || "the current selection"}.`
    : approvedReportFocus
      ? `Email will include the approved PDF report focused on ${approvedReportFocus}.`
      : "Email will include the approved PDF report.";

  const params = useMemo(() => {
    const next = { limit: 100 };
    if (filters.industryId) next.industryId = filters.industryId;
    if (filters.serviceId) next.serviceId = filters.serviceId;
    if (filters.pipelineWorkflowStatus) next.pipelineWorkflowStatus = filters.pipelineWorkflowStatus;
    if (filters.highConfidence) next.highConfidence = "true";
    if (filters.needsReview) next.needsReview = "true";
    if (filters.emailStatus) next.emailStatus = filters.emailStatus;
    if (filters.hasContactEmail) next.hasContactEmail = filters.hasContactEmail;
    if (filters.followUpState) next.followUpState = filters.followUpState;
    if (filters.replyType) next.replyType = filters.replyType;
    if (filters.actionState) next.actionState = filters.actionState;
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
  const allVisibleSelected = visibleLeads.length > 0 && visibleLeads.every((lead) => selectedIds.includes(lead.id));

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
      await Promise.all([loadData(), selectedLead?.id ? loadReportForLead(selectedLead.id) : Promise.resolve()]);
      clearInterval(progressTimer);
      setReplySyncProgress({ percent: 100, label: `Sync complete: ${data.leadsUpdated} leads updated.` });
      push(`Reply sync complete: ${data.repliesFound} replies found, ${data.leadsUpdated} leads updated.`);
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

  async function generateDueFollowUps() {
    setBatch({ total: 1, completed: 0, approved: 0, skipped: 0, failed: 0, running: true, current: "Generating due follow-up drafts..." });
    try {
      const { data } = await api.post("/follow-ups/generate-due");
      await loadData();
      setBatch({
        total: data.total || 0,
        completed: data.total || 0,
        approved: data.generated || 0,
        skipped: data.skipped || 0,
        failed: data.failed || 0,
        running: false,
        current: "",
        skippedReasons: (data.skippedReasons || []).map((item) => `${item.leadName}: ${item.reason}`),
        failedReasons: (data.failedReasons || []).map((item) => `${item.leadName}: ${item.reason}`)
      });
      push(`Generated ${data.generated || 0} due follow-up drafts.`);
    } catch (error) {
      setBatch({ total: 1, completed: 1, approved: 0, skipped: 0, failed: 1, running: false, current: "", failedReasons: [error.response?.data?.message || "Could not generate due follow-ups"] });
      push(error.response?.data?.message || "Could not generate due follow-ups", "error");
    }
  }

  async function generateFollowUpDraftsFor(source = "selected") {
    const targets = source === "all" ? visibleLeads : visibleLeads.filter((lead) => selectedIds.includes(lead.id));
    if (!targets.length) return push("Select at least one lead", "error");
    setBatch({ total: 1, completed: 0, approved: 0, skipped: 0, failed: 0, running: true, current: "Generating follow-up drafts..." });
    try {
      const { data } = await api.post("/follow-ups/generate-batch", { leadIds: targets.map((lead) => lead.id) });
      await loadData();
      setBatch({
        total: data.total || 0,
        completed: data.total || 0,
        approved: data.generated || 0,
        skipped: data.skipped || 0,
        failed: data.failed || 0,
        running: false,
        current: "",
        skippedReasons: (data.skippedReasons || []).map((item) => `${item.leadName}: ${item.reason}`),
        failedReasons: (data.failedReasons || []).map((item) => `${item.leadName}: ${item.reason}`)
      });
      push(`Generated ${data.generated || 0} follow-up drafts.`);
    } catch (error) {
      setBatch({ total: 1, completed: 1, approved: 0, skipped: 0, failed: 1, running: false, current: "", failedReasons: [error.response?.data?.message || "Could not generate follow-up drafts"] });
      push(error.response?.data?.message || "Could not generate follow-up drafts", "error");
    }
  }

  async function sendDueFollowUps() {
    if (!gmailReady) return push("Connect Gmail before sending", "error");
    setBatch({ total: 1, completed: 0, approved: 0, skipped: 0, failed: 0, running: true, current: "Sending due follow-ups...", mode: "sending" });
    try {
      const { data } = await api.post("/follow-ups/send-due");
      await loadData();
      setBatch({
        total: data.total || 0,
        completed: data.total || 0,
        approved: data.sent || 0,
        skipped: data.skipped || 0,
        failed: data.failed || 0,
        running: false,
        current: "",
        mode: "sending",
        skippedReasons: (data.skippedReasons || []).map((item) => `${item.leadName}: ${item.reason}`),
        failedReasons: (data.failedReasons || []).map((item) => `${item.leadName}: ${item.reason}`)
      });
      push(`Send due follow-ups complete: ${data.sent || 0} sent, ${data.skipped || 0} skipped.`);
    } catch (error) {
      setBatch({ total: 1, completed: 1, approved: 0, skipped: 0, failed: 1, running: false, current: "", mode: "sending", failedReasons: [error.response?.data?.message || "Could not send due follow-ups"] });
      push(error.response?.data?.message || "Could not send due follow-ups", "error");
    }
  }

  async function generateSelectedLeadFollowUp() {
    if (!selectedLead?.id) return push("Select a lead first", "error");
    setFollowUpDraftState((current) => ({ ...current, loading: true }));
    try {
      const { data } = await api.post(`/follow-ups/${selectedLead.id}/generate`);
      setFollowUpDraftState({
        loading: false,
        saving: false,
        open: true,
        draftId: data.draft?.id || "",
        subject: data.draft?.subject || "",
        body: data.draft?.fullMessage || "",
        type: data.draft?.type || ""
      });
      push(`Generated follow-up ${data.step} draft`);
      await loadData();
    } catch (error) {
      setFollowUpDraftState((current) => ({ ...current, loading: false }));
      push(error.response?.data?.message || "Could not generate follow-up draft", "error");
    }
  }

  async function sendSelectedLeadFollowUp({ overrideDue = false } = {}) {
    if (!selectedLead?.id) return push("Select a lead first", "error");
    if (!gmailReady) return push("Connect Gmail before sending", "error");
    try {
      const { data } = await api.post(`/follow-ups/${selectedLead.id}/send`, { overrideDue });
      push(`Follow-up ${data.step} sent`);
      await loadData();
    } catch (error) {
      push(error.response?.data?.message || "Could not send follow-up", "error");
    }
  }

  async function sendSelectedLeadFollowUpNow() {
    if (!selectedLead?.id) return push("Select a lead first", "error");
    if (!window.confirm("Send this follow-up now even if it is not due yet?")) return;
    await sendSelectedLeadFollowUp({ overrideDue: true });
  }

  async function saveFollowUpDraftEdit() {
    if (!followUpDraftState.draftId) return;
    setFollowUpDraftState((current) => ({ ...current, saving: true }));
    try {
      await api.put(`/outreach/${followUpDraftState.draftId}`, {
        subject: followUpDraftState.subject,
        fullMessage: followUpDraftState.body
      });
      push("Follow-up draft saved");
      await loadData();
    } catch (error) {
      push(error.response?.data?.message || "Could not save follow-up draft", "error");
    } finally {
      setFollowUpDraftState((current) => ({ ...current, saving: false }));
    }
  }

  async function classifySelectedReply() {
    if (!selectedLead?.id) return push("Select a lead first", "error");
    try {
      const { data } = await api.post(`/leads/${selectedLead.id}/classify-reply`);
      push(`Reply classified as ${data.classification.classification.toLowerCase().replaceAll("_", " ")}`);
      await loadData();
    } catch (error) {
      push(error.response?.data?.message || "Could not classify reply", "error");
    }
  }

  async function generateSelectedReplyDraft() {
    if (!selectedLead?.id) return push("Select a lead first", "error");
    setReplyDraftLoading(true);
    try {
      const { data } = await api.post(`/leads/${selectedLead.id}/generate-reply-draft`);
      setReplyDraft(data.body || "");
      push("Reply draft generated");
    } catch (error) {
      push(error.response?.data?.message || "Could not generate reply draft", "error");
    } finally {
      setReplyDraftLoading(false);
    }
  }

  async function loadReportForLead(leadId) {
    if (!leadId) return setReport(null);
    setReportLoading(true);
    try {
      const { data } = await api.get(`/leads/${leadId}/report`);
      setReport(data);
      setReportServices((data?.selectedServices || []).map((item) => item.id).filter(Boolean).length ? data.selectedServices.map((item) => item.id) : DEFAULT_REPORT_SERVICE_IDS);
    } catch (error) {
      if (error.response?.status !== 404) push(error.response?.data?.message || "Could not load report", "error");
      setReport(null);
      const lead = leads.find((item) => item.id === leadId);
      setReportServices(selectedServiceIdsForLead(lead).length ? selectedServiceIdsForLead(lead) : DEFAULT_REPORT_SERVICE_IDS);
    } finally {
      setReportLoading(false);
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
    setFollowUpDraftState({ loading: false, saving: false, open: false, draftId: "", subject: "", body: "", type: "" });
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
    if (selectedServiceIdsForLead(selectedLead).length) setReportServices(selectedServiceIdsForLead(selectedLead));
    setReport(selectedLead.auditReports?.[0] || null);
  }, [selectedLead?.id, senderProfile?.id, gmailSender?.email, outreachPersona?.enabled, outreachPersona?.assistantName, outreachPersona?.assistantEmail]);

  useEffect(() => {
    loadReportForLead(selectedLead?.id).catch(() => {});
  }, [selectedLead?.id]);

  useEffect(() => {
    setIncludeReport(Boolean(report?.canAttach));
  }, [report?.id, report?.canAttach]);

  useEffect(() => {
    if (!selectedLead || !draft.subject || !finalBody.trim() || !observation) {
      setLiveQualityGate(null);
      return undefined;
    }
    const reportContext = includeReport && reportReady
      ? {
          selectedServices: previewReportServices,
          attachmentEnabled: true
        }
      : undefined;
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.post("/outreach/email-quality-gate", {
          email: {
            subject: draft.subject,
            body: finalBody
          },
          selectedObservation: observation,
          company: {
            name: selectedLead.company,
            website: selectedLead.website
          },
          industry: selectedLead.industryRef?.name || selectedLead.industry || "",
          businessType: selectedLead.scanEvidence?.businessUnderstanding?.businessIdentity?.businessType || "",
          ...(reportContext ? { reportContext } : {})
        });
        setLiveQualityGate(data);
      } catch {
        setLiveQualityGate(null);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [
    selectedLead?.id,
    draft.subject,
    finalBody,
    observation?.id,
    includeReport,
    reportReady,
    JSON.stringify(previewReportServices)
  ]);

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

  function updateLeadBatchProgress(leadId, patch) {
    setBatchLeadProgress((current) => ({
      ...current,
      [leadId]: {
        ...(current[leadId] || {}),
        ...patch
      }
    }));
  }

  function clearBatchProgress(leadIds = []) {
    if (!leadIds.length) return setBatchLeadProgress({});
    setBatchLeadProgress((current) => {
      const next = { ...current };
      for (const leadId of leadIds) delete next[leadId];
      return next;
    });
  }

  async function analyzeServicesForLead(lead, { force = false, silent = false } = {}) {
    const { data } = await api.post("/outreach/pipeline/analyze-services", { leadId: lead.id, force });
    const analyzedServices = Array.isArray(data.analyzedServices) ? data.analyzedServices : [];
    const selectedReportServices = Array.isArray(data.selectedReportServices) ? data.selectedReportServices : [];
    const normalizedStatus = data.status === "completed" && analyzedServices.length && selectedReportServices.length
      ? "completed"
      : data.status === "failed"
        ? "failed"
        : "not_started";
    const nextLead = {
      ...lead,
      serviceAnalysisStatus: normalizedStatus,
      serviceAnalysisError: data.error || null,
      serviceAnalyzedAt: data.analyzedAt || null,
      analyzedServices,
      selectedReportServices,
      selectedServicesSource: data.selectedServicesSource || "auto"
    };
    setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, ...nextLead } : item));
    if (selectedLead?.id === lead.id && nextLead.selectedReportServices?.length) setReportServices(nextLead.selectedReportServices);
    if (normalizedStatus !== "completed") {
      const message = data.error || "Service analysis did not produce any selected services";
      if (!silent) push(message, "error");
      throw new Error(message);
    }
    if (!silent) push("Services analyzed");
    return nextLead;
  }

  async function persistSelectedServices(leadId, selectedServices) {
    const { data } = await api.put(`/outreach/pipeline/services/${leadId}`, { selectedReportServices: selectedServices });
    setLeads((current) => current.map((lead) => lead.id === leadId ? {
      ...lead,
      serviceAnalysisStatus: data.status || lead.serviceAnalysisStatus,
      serviceAnalysisError: data.error || null,
      serviceAnalyzedAt: data.analyzedAt || lead.serviceAnalyzedAt,
      analyzedServices: data.analyzedServices || lead.analyzedServices || [],
      selectedReportServices: data.selectedReportServices || selectedServices,
      selectedServicesSource: data.selectedServicesSource || "manual",
      pipelineWorkflow: lead.pipelineWorkflow ? {
        ...lead.pipelineWorkflow,
        selectedReportServices: data.selectedReportServices || selectedServices,
        selectedServicesSource: data.selectedServicesSource || "manual"
      } : lead.pipelineWorkflow
    } : lead));
    if (selectedLead?.id === leadId) setReportServices(data.selectedReportServices || selectedServices);
    return data;
  }

  async function changeSelectedLeadServices(next) {
    setReportServices(next);
    if (!selectedLead?.id) return;
    try {
      await persistSelectedServices(selectedLead.id, next);
    } catch (error) {
      push(error.response?.data?.message || "Could not save selected services", "error");
    }
  }

  function leadRunEligibility(lead) {
    if (!lead?.website) return { eligible: false, reason: "Missing website" };
    if (!contactEmail(lead)) return { eligible: false, reason: "Missing contact email" };
    return { eligible: true };
  }

  function moveLead(direction) {
    const index = visibleLeads.findIndex((lead) => lead.id === selectedLead?.id);
    const next = visibleLeads[index + direction];
    if (next) selectLead(next);
  }

  async function runPipeline(lead = selectedLead, options = {}) {
    if (!lead) return push("Select a lead first", "error");
    const eligibility = leadRunEligibility(lead);
    if (!eligibility.eligible) {
      push(eligibility.reason, "error");
      throw new Error(eligibility.reason);
    }
    setRunningLeadId(lead.id);
    setLeadWorkflow(lead.id, { ...pipelineState(lead), status: "ANALYSING", label: "Analysing" });
    const generatingTimer = setTimeout(() => {
      setLeadWorkflow(lead.id, { ...pipelineState(lead), status: "GENERATING_EMAIL", label: "Generating Email" });
    }, 900);
    try {
      let workingLead = lead;
      if (options.analyzeServicesIfMissing !== false && (!selectedServiceIdsForLead(workingLead).length || workingLead.serviceAnalysisStatus !== "completed")) {
        workingLead = await analyzeServicesForLead(workingLead, { silent: true });
      }
      const selectedServicesForLead = options.selectedServices
        || (lead.id === selectedLead?.id ? reportServices : selectedServiceIdsForLead(workingLead))
        || batchReportServices;
      if (!selectedServicesForLead?.length) {
        throw new Error("No services selected for this lead");
      }
      const { data } = await api.post("/outreach/pipeline", {
        leadId: lead.id,
        company: { name: lead.company, website: lead.website },
        industry: lead.industryRef?.name || lead.industry || "",
        sender: { name: activeSender.name, title: activeSender.title, company: activeSender.company },
        selectedServices: selectedServicesForLead,
        attachmentEnabled: options.attachmentEnabled !== false,
        analyzeServicesIfMissing: options.analyzeServicesIfMissing !== false,
        generateReport: options.generateReport !== false
      });
      setLeadWorkflow(lead.id, data.pipelineState || { status: data.status === "approved" ? "APPROVED" : data.status === "no_suitable_angle" ? "NO_SUITABLE_ANGLE" : "NEEDS_REVIEW", result: data });
      setLeads((current) => current.map((item) => item.id === lead.id ? {
        ...item,
        pipelineWorkflow: data.pipelineState || item.pipelineWorkflow,
        pipelineWorkflowStatus: data.pipelineState?.status || item.pipelineWorkflowStatus,
        pipelineConfidence: data.pipelineState?.confidence || item.pipelineConfidence,
        pipelineQualityScore: data.pipelineState?.qualityScore || item.pipelineQualityScore,
        pipelineObservationCategory: data.pipelineState?.observationCategory || item.pipelineObservationCategory,
        selectedReportServices: data.pipelineState?.selectedReportServices || selectedServicesForLead,
        selectedServicesSource: data.pipelineState?.selectedServicesSource || item.selectedServicesSource,
        analyzedServices: data.pipelineState?.analyzedServices || item.analyzedServices,
        serviceAnalysisStatus: data.pipelineState?.serviceAnalysisStatus || item.serviceAnalysisStatus,
        auditReports: data.report ? [data.report] : item.auditReports
      } : item));
      if (lead.id === selectedLead?.id) {
        setPipelineResult(data);
        setComposerFromResult(lead, data);
        if (data.pipelineState?.selectedReportServices?.length) setReportServices(data.pipelineState.selectedReportServices);
        if (data.report) {
          setReport(data.report);
          const returnedServices = (data.report.selectedServices || []).map((item) => item.id).filter(Boolean);
          if (returnedServices.length) setReportServices(returnedServices);
        } else if (data.status === "approved") {
          await loadReportForLead(lead.id);
        }
      }
      if (!options.silent && data.status === "approved" && data.reportError) push(`Email approved, but the PDF report failed: ${data.reportError}`, "error");
      if (!options.silent && data.status === "approved") push("Email approved for review");
      if (!options.silent && data.status === "rejected") push("A service-matched draft was generated, but it still needs review.", "error");
      if (!options.silent && data.status === "no_suitable_angle") push("Automatic angle selection was too strict, so review the best available draft below.", "error");
      return data;
    } catch (error) {
      setLeadWorkflow(lead.id, { ...pipelineState(lead), status: "REJECTED", label: "Rejected", qualityGate: { reason: error.response?.data?.message || "Pipeline failed" } });
      if (!options.silent) push(error.response?.data?.message || "Pipeline failed", "error");
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
        emailSelectedServices: reportServices,
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
    if (emailServiceMismatch) return push("Email does not match the selected report services. Regenerate email before sending.", "error");
    if (reportServiceMismatch && includeReport) return push("The approved PDF report does not match the currently selected services. Regenerate and approve the report first.", "error");
    setSending(true);
    setSingleSendProgress({ running: true, label: "Preparing email...", percent: 15, error: false });
    try {
      setSingleSendProgress({ running: true, label: "Saving latest draft...", percent: 35, error: false });
      const saved = await saveDraft();
      if (!saved) return;
      setSingleSendProgress({ running: true, label: `Sending to ${draft.toEmail}...`, percent: 70, error: false });
      const { data } = await api.post("/email/send", {
        leadId: selectedLead.id,
        toEmail: draft.toEmail,
        subject: draft.subject,
        body: finalBody,
        includeReport,
        emailSelectedServices: reportServices,
        fromName: draft.fromName,
        fromEmail: draft.fromEmail,
        senderTitle: activeSender.title,
        senderCompany: activeSender.company,
        contactFirstName: firstName(selectedLead),
        companyName: selectedLead.company
      });
      if (data.status === "SENT") {
        setSingleSendProgress({ running: true, label: "Finalizing send...", percent: 95, error: false });
        push("Email sent");
        await loadData();
        await loadReportForLead(selectedLead.id);
        setSingleSendProgress({ running: false, label: "Email sent", percent: 100, error: false });
        moveLead(1);
      } else {
        setSingleSendProgress({ running: false, label: data.errorMessage || "Email send failed", percent: 100, error: true });
        push(data.errorMessage || "Email send failed", "error");
      }
    } catch (error) {
      if (error.response?.status === 409 && /Duplicate outreach blocked:/i.test(error.response?.data?.message || "")) {
        const confirmed = window.confirm(`${error.response.data.message}\n\nSend anyway for this lead?`);
        if (confirmed) {
          try {
            const { data } = await api.post("/email/send", {
              leadId: selectedLead.id,
              toEmail: draft.toEmail,
              subject: draft.subject,
              body: finalBody,
              includeReport,
              emailSelectedServices: reportServices,
              fromName: draft.fromName,
              fromEmail: draft.fromEmail,
              senderTitle: activeSender.title,
              senderCompany: activeSender.company,
              contactFirstName: firstName(selectedLead),
              companyName: selectedLead.company,
              allowDuplicate: true
            });
            if (data.status === "SENT") {
              push("Email sent with duplicate override");
              await loadData();
              await loadReportForLead(selectedLead.id);
              setSingleSendProgress({ running: false, label: "Email sent", percent: 100, error: false });
              return;
            }
          } catch (overrideError) {
            setSingleSendProgress({ running: false, label: overrideError.response?.data?.message || "Email send failed", percent: 100, error: true });
            push(overrideError.response?.data?.message || "Email send failed", "error");
            return;
          }
        }
      }
      setSingleSendProgress({ running: false, label: error.response?.data?.message || "Email send failed", percent: 100, error: true });
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
    if (emailServiceMismatch) return push("Email does not match the selected report services. Regenerate email before sending.", "error");
    if (reportServiceMismatch && includeReport) return push("The approved PDF report does not match the currently selected services. Regenerate and approve the report first.", "error");
    setSendingTest(true);
    try {
      const saved = await saveDraft();
      if (!saved) return;
      const { data } = await api.post("/email/test", {
        leadId: selectedLead.id,
        fromName: draft.fromName,
        fromEmail: draft.fromEmail,
        senderTitle: activeSender.title,
        senderCompany: activeSender.company,
        contactFirstName: firstName(selectedLead),
        companyName: selectedLead.company,
        toEmail: testEmail,
        subject: draft.subject,
        body: finalBody,
        includeReport,
        emailSelectedServices: reportServices
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
    clearBatchProgress();
    targets.forEach((lead) => updateLeadBatchProgress(lead.id, {
      status: "queued",
      analysisStatus: batchOptions.analyzeServicesIfMissing ? "queued" : "skipped",
      reportStatus: batchOptions.generateReport ? "queued" : "skipped",
      emailStatus: batchOptions.generateEmail ? "queued" : "skipped",
      error: null
    }));
    const progress = { total: targets.length, completed: 0, approved: 0, rejected: 0, skipped: 0, errors: 0, current: "", skippedReasons: [], failedReasons: [] };
    setBatch({ ...progress, running: true });
    const queue = [...targets];
    const concurrency = Math.max(1, Number(batchConcurrency || 4));
    const worker = async () => {
      while (queue.length && !cancelBatchRef.current) {
        const lead = queue.shift();
        if (!lead) return;
        progress.current = lead.company;
        setBatch({ ...progress, running: true });
        try {
          await processLeadBatchPipeline(lead, {
            analyzeServicesIfMissing: true,
            generateReport: batchOptions.generateReport,
            generateEmail: batchOptions.generateEmail || batchOptions.runQualityGate
          });
          progress.approved += 1;
        } catch (error) {
          progress.errors += 1;
          progress.failedReasons.push(`${lead.company}: ${error.response?.data?.message || error.message || "Lead processing failed"}`);
        }
        progress.completed += 1;
        setBatch({ ...progress, running: true });
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()));
    if (cancelBatchRef.current && progress.completed < progress.total) {
      progress.skipped += progress.total - progress.completed;
    }
    setBatch({ ...progress, running: false, current: "" });
    push(`Batch pipeline complete: ${progress.approved} completed, ${progress.skipped} skipped, ${progress.errors} failed`);
    await loadData();
  }

  async function analyzeServicesForBatch(source = "selected") {
    const targets = source === "all" ? visibleLeads : visibleLeads.filter((lead) => selectedIds.includes(lead.id));
    if (!targets.length) return push("Select at least one lead", "error");
    cancelBatchRef.current = false;
    const progress = { total: targets.length, completed: 0, approved: 0, rejected: 0, skipped: 0, errors: 0, current: "", skippedReasons: [], failedReasons: [] };
    setBatch({ ...progress, running: true });
    for (const lead of targets) {
      if (cancelBatchRef.current) break;
      progress.current = lead.company;
      setBatch({ ...progress, running: true });
      try {
        const analyzed = await analyzeServicesForLead(lead, { force: true, silent: true });
        if (analyzed.serviceAnalysisStatus === "completed") progress.approved += 1;
        else throw new Error(analyzed.serviceAnalysisError || "Service analysis failed");
      } catch (error) {
        progress.errors += 1;
        progress.failedReasons.push(`${lead.company}: ${error.response?.data?.message || error.message || "Service analysis failed"}`);
      }
      progress.completed += 1;
      setBatch({ ...progress, running: true });
    }
    setBatch({ ...progress, running: false, current: "" });
    push(`Service analysis complete: ${progress.approved} completed, ${progress.errors} failed`);
    await loadData();
  }

  async function bulkApproveReports() {
    const targets = visibleLeads.filter((lead) => selectedIds.includes(lead.id));
    if (!targets.length) return push("Select at least one lead", "error");
    const summary = { approved: 0, skipped: 0, failed: 0, skippedReasons: [], failedReasons: [] };
    for (const lead of targets) {
      const leadReport = lead.auditReports?.[0] || null;
      if (!leadReport) {
        summary.skipped += 1;
        summary.skippedReasons.push(`${lead.company}: Report missing`);
        continue;
      }
      if (!leadReport.qualityGate?.passed) {
        summary.skipped += 1;
        summary.skippedReasons.push(`${lead.company}: Report failed quality gate`);
        continue;
      }
      if (["approved", "attached", "sent"].includes(leadReport.status)) {
        summary.skipped += 1;
        summary.skippedReasons.push(`${lead.company}: Report already approved`);
        continue;
      }
      try {
        await api.post(`/leads/${lead.id}/report/approve`);
        summary.approved += 1;
      } catch (error) {
        summary.failed += 1;
        summary.failedReasons.push(`${lead.company}: ${error.response?.data?.message || "PDF file missing"}`);
      }
    }
    await loadData();
    push(`Bulk report approval complete: ${summary.approved} approved, ${summary.skipped} skipped, ${summary.failed} failed`);
    setBatch({ total: targets.length, completed: targets.length, running: false, current: "", ...summary });
  }

  async function sendSelectedEmails() {
    const targets = visibleLeads.filter((lead) => selectedIds.includes(lead.id));
    if (!targets.length) return push("Select at least one lead", "error");
    if (!gmailReady) return push("Connect Gmail before sending", "error");
    cancelBatchRef.current = false;
    clearBatchProgress(targets.map((lead) => lead.id));
    targets.forEach((lead) => updateLeadBatchProgress(lead.id, {
      status: "queued",
      emailStatus: "queued",
      error: null
    }));
    const summary = { approved: 0, skipped: 0, failed: 0, skippedReasons: [], failedReasons: [] };
    setBatch({ total: targets.length, completed: 0, approved: 0, skipped: 0, failed: 0, running: true, current: "", mode: "sending", skippedReasons: [], failedReasons: [] });
    for (const lead of targets) {
      if (cancelBatchRef.current) {
        summary.skipped += 1;
        summary.skippedReasons.push(`${lead.company}: Sending cancelled before this lead started`);
        updateLeadBatchProgress(lead.id, { status: "failed", emailStatus: "skipped", error: "Sending cancelled" });
        setBatch((current) => ({ ...(current || {}), completed: summary.approved + summary.skipped + summary.failed, approved: summary.approved, skipped: summary.skipped, failed: summary.failed, skippedReasons: [...summary.skippedReasons], failedReasons: [...summary.failedReasons] }));
        continue;
      }
      updateLeadBatchProgress(lead.id, { status: "running", emailStatus: "queued", error: null });
      setBatch((current) => ({ ...(current || {}), running: true, current: lead.company }));
      const state = pipelineState(lead);
      const leadReport = lead.auditReports?.[0] || null;
      const email = state?.editedDraft?.fullEmail || state?.email?.body || "";
      const subject = state?.editedDraft?.subject || state?.email?.subject || "";
      const emailSelectedServices = state?.emailSelectedServices || selectedServiceIdsForLead(lead);
      if (state.status !== "APPROVED") {
        summary.skipped += 1;
        summary.skippedReasons.push(`${lead.company}: Lead not approved`);
        updateLeadBatchProgress(lead.id, { status: "failed", emailStatus: "skipped", error: "Lead not approved" });
        setBatch((current) => ({ ...(current || {}), completed: summary.approved + summary.skipped + summary.failed, approved: summary.approved, skipped: summary.skipped, failed: summary.failed, skippedReasons: [...summary.skippedReasons], failedReasons: [...summary.failedReasons] }));
        continue;
      }
      if (!contactEmail(lead)) {
        summary.skipped += 1;
        summary.skippedReasons.push(`${lead.company}: Missing recipient email`);
        updateLeadBatchProgress(lead.id, { status: "failed", emailStatus: "skipped", error: "Missing recipient email" });
        setBatch((current) => ({ ...(current || {}), completed: summary.approved + summary.skipped + summary.failed, approved: summary.approved, skipped: summary.skipped, failed: summary.failed, skippedReasons: [...summary.skippedReasons], failedReasons: [...summary.failedReasons] }));
        continue;
      }
      if (!subject || !email) {
        summary.skipped += 1;
        summary.skippedReasons.push(`${lead.company}: Email missing`);
        updateLeadBatchProgress(lead.id, { status: "failed", emailStatus: "skipped", error: "Email missing" });
        setBatch((current) => ({ ...(current || {}), completed: summary.approved + summary.skipped + summary.failed, approved: summary.approved, skipped: summary.skipped, failed: summary.failed, skippedReasons: [...summary.skippedReasons], failedReasons: [...summary.failedReasons] }));
        continue;
      }
      if (!state?.qualityGate?.approved) {
        summary.skipped += 1;
        summary.skippedReasons.push(`${lead.company}: Email quality gate not approved`);
        updateLeadBatchProgress(lead.id, { status: "failed", emailStatus: "skipped", error: "Email quality gate not approved" });
        setBatch((current) => ({ ...(current || {}), completed: summary.approved + summary.skipped + summary.failed, approved: summary.approved, skipped: summary.skipped, failed: summary.failed, skippedReasons: [...summary.skippedReasons], failedReasons: [...summary.failedReasons] }));
        continue;
      }
      if (!sameServiceSelection(emailSelectedServices, selectedServiceIdsForLead(lead))) {
        summary.skipped += 1;
        summary.skippedReasons.push(`${lead.company}: Email/report services do not match`);
        updateLeadBatchProgress(lead.id, { status: "failed", emailStatus: "skipped", error: "Email/report services do not match" });
        setBatch((current) => ({ ...(current || {}), completed: summary.approved + summary.skipped + summary.failed, approved: summary.approved, skipped: summary.skipped, failed: summary.failed, skippedReasons: [...summary.skippedReasons], failedReasons: [...summary.failedReasons] }));
        continue;
      }
      if (batchOptions.includeAttachmentWhenSending && (!leadReport || !["approved", "attached", "sent"].includes(leadReport.status))) {
        summary.skipped += 1;
        summary.skippedReasons.push(`${lead.company}: Approved attachable report missing`);
        updateLeadBatchProgress(lead.id, { status: "failed", emailStatus: "skipped", error: "Approved attachable report missing" });
        setBatch((current) => ({ ...(current || {}), completed: summary.approved + summary.skipped + summary.failed, approved: summary.approved, skipped: summary.skipped, failed: summary.failed, skippedReasons: [...summary.skippedReasons], failedReasons: [...summary.failedReasons] }));
        continue;
      }
      try {
        updateLeadBatchProgress(lead.id, { status: "running", emailStatus: "running", error: null });
        const { data } = await api.post("/email/send", {
          leadId: lead.id,
          toEmail: contactEmail(lead),
          subject,
          body: email,
          includeReport: batchOptions.includeAttachmentWhenSending,
          emailSelectedServices,
          fromName: activeSender.name,
          fromEmail: activeSender.email,
          senderTitle: activeSender.title,
          senderCompany: activeSender.company,
          contactFirstName: firstName(lead),
          companyName: lead.company
        });
        if (data.status === "SENT") {
          summary.approved += 1;
          updateLeadBatchProgress(lead.id, { status: "completed", emailStatus: "completed", error: null });
        } else {
          summary.failed += 1;
          const message = data.errorMessage || "Email send failed";
          summary.failedReasons.push(`${lead.company}: ${message}`);
          updateLeadBatchProgress(lead.id, { status: "failed", emailStatus: "failed", error: message });
        }
      } catch (error) {
        summary.failed += 1;
        const message = error.response?.data?.message || "Email send failed";
        summary.failedReasons.push(`${lead.company}: ${message}`);
        updateLeadBatchProgress(lead.id, { status: "failed", emailStatus: "failed", error: message });
      }
      setBatch((current) => ({ ...(current || {}), completed: summary.approved + summary.skipped + summary.failed, approved: summary.approved, skipped: summary.skipped, failed: summary.failed, skippedReasons: [...summary.skippedReasons], failedReasons: [...summary.failedReasons] }));
    }
    await loadData();
    push(`${cancelBatchRef.current ? "Bulk email sending stopped" : "Bulk email sending complete"}: ${summary.approved} sent, ${summary.skipped} skipped, ${summary.failed} failed`);
    setBatch({ total: targets.length, completed: targets.length, running: false, current: "", mode: "sending", ...summary });
  }

  function toggleSelected(leadId) {
    setSelectedIds((current) => current.includes(leadId) ? current.filter((id) => id !== leadId) : [...current, leadId]);
  }

  function toggleSelectVisibleLeads() {
    const visibleIds = visibleLeads.map((lead) => lead.id);
    setSelectedIds((current) => (
      allVisibleSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : [...new Set([...current, ...visibleIds])]
    ));
  }

  async function generateReportForSelected(mode = "generate") {
    if (!selectedLead) return push("Select a lead first", "error");
    if (!reportServices.length) return push("Please select at least one service to include in the report.", "error");
    setReportAction(mode);
    try {
      const { data } = await api.post(mode === "regenerate" ? `/leads/${selectedLead.id}/report/regenerate` : `/leads/${selectedLead.id}/report/generate`, {
        selectedServices: reportServices
      });
      setReport(data);
      setReportServices((data?.selectedServices || []).map((item) => item.id).filter(Boolean).length ? data.selectedServices.map((item) => item.id) : reportServices);
      push(mode === "regenerate" ? "Report regenerated" : "Report generated");
    } catch (error) {
      push(error.response?.data?.message || "Could not generate report", "error");
    } finally {
      setReportAction("");
    }
  }

  async function generateReportForLead(lead, selectedServices, mode = "generate") {
    const endpoint = mode === "regenerate" ? `/leads/${lead.id}/report/regenerate` : `/leads/${lead.id}/report/generate`;
    const { data } = await api.post(endpoint, { selectedServices });
    setLeads((current) => current.map((item) => item.id === lead.id ? {
      ...item,
      auditReports: data ? [data] : item.auditReports
    } : item));
    if (selectedLead?.id === lead.id) {
      setReport(data);
      const returnedServices = (data?.selectedServices || []).map((item) => item.id).filter(Boolean);
      if (returnedServices.length) setReportServices(returnedServices);
    }
    return data;
  }

  async function retryFailedTaskOnce(taskName, task) {
    try {
      return await task();
    } catch (_firstError) {
      return await task();
    }
  }

  async function processLeadBatchPipeline(lead, options = {}) {
    const eligibility = leadRunEligibility(lead);
    if (!eligibility.eligible) {
      updateLeadBatchProgress(lead.id, { status: "failed", error: eligibility.reason });
      throw new Error(eligibility.reason);
    }

    updateLeadBatchProgress(lead.id, {
      status: "running",
      analysisStatus: "queued",
      reportStatus: options.generateReport === false ? "skipped" : "queued",
      emailStatus: options.generateEmail === false ? "skipped" : "queued",
      error: null
    });

    let workingLead = lead;
    if (options.analyzeServicesIfMissing !== false) {
      updateLeadBatchProgress(lead.id, { analysisStatus: "running" });
      workingLead = await analyzeServicesForLead(lead, { silent: true });
      updateLeadBatchProgress(lead.id, { analysisStatus: "completed" });
    }

    const selectedServices = selectedServiceIdsForLead(workingLead).length ? selectedServiceIdsForLead(workingLead) : batchReportServices;
    if (!selectedServices.length) {
      updateLeadBatchProgress(lead.id, { status: "failed", error: "No analyzed services selected" });
      throw new Error("No analyzed services selected");
    }

    const tasks = [];

    if (options.generateEmail !== false) {
      tasks.push((async () => {
        updateLeadBatchProgress(lead.id, { emailStatus: "running" });
        const result = await retryFailedTaskOnce("email", () => runPipeline(workingLead, {
          analyzeServicesIfMissing: false,
          generateReport: false,
          selectedServices,
          attachmentEnabled: false,
          silent: true
        }));
        updateLeadBatchProgress(lead.id, { emailStatus: "completed" });
        return result;
      })().catch((error) => {
        updateLeadBatchProgress(lead.id, { emailStatus: "failed" });
        throw new Error(error.response?.data?.message || error.message || "Email generation failed");
      }));
    }

    if (options.generateReport !== false) {
      tasks.push((async () => {
        updateLeadBatchProgress(lead.id, { reportStatus: "running" });
        const result = await retryFailedTaskOnce("report", () => generateReportForLead(workingLead, selectedServices));
        updateLeadBatchProgress(lead.id, { reportStatus: "completed" });
        return result;
      })().catch((error) => {
        updateLeadBatchProgress(lead.id, { reportStatus: "failed" });
        throw new Error(error.response?.data?.message || error.message || "PDF generation failed");
      }));
    }

    const settled = await Promise.allSettled(tasks);
    const failure = settled.find((item) => item.status === "rejected");
    if (failure) {
      const errorMessage = failure.reason?.message || "Lead processing failed";
      updateLeadBatchProgress(lead.id, { status: "failed", error: errorMessage });
      throw new Error(errorMessage);
    }

    updateLeadBatchProgress(lead.id, { status: "completed" });
    return { leadId: lead.id, selectedServices };
  }

  async function approveSelectedReport() {
    if (!selectedLead) return push("Select a lead first", "error");
    setReportAction("approve");
    try {
      const { data } = await api.post(`/leads/${selectedLead.id}/report/approve`);
      setReport(data);
      push("Report approved");
    } catch (error) {
      push(error.response?.data?.message || "Could not approve report", "error");
    } finally {
      setReportAction("");
    }
  }

  function openAndDownloadReport() {
    if (!report?.previewUrl || !report?.downloadUrl) {
      push(report?.status === "failed" || report?.status === "failed_quality_gate"
        ? "Report generation failed. Please regenerate the report."
        : "Report has not been generated yet.", "error");
      return;
    }
    const previewWindow = window.open(report.previewUrl, "_blank", "noopener,noreferrer");
    const link = document.createElement("a");
    link.href = report.downloadUrl;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (!previewWindow) {
      push("The report was downloaded. If the preview did not open, please allow popups for this site.", "error");
    }
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
          <Button variant="secondary" disabled={syncingReplies} onClick={syncReplies}><RefreshCw size={16} /> {syncingReplies ? "Syncing replies..." : "Sync Replies"}</Button>
          <Button variant="secondary" onClick={generateDueFollowUps}><FileText size={16} /> Generate due follow-ups</Button>
          <Button variant="secondary" disabled={!gmailReady} onClick={sendDueFollowUps}><Send size={16} /> Send due follow-ups</Button>
          <Button variant="secondary" disabled={!selectedLead || Boolean(runningLeadId)} onClick={() => selectedLead && analyzeServicesForLead(selectedLead)}><RefreshCw size={16} /> Analyze services</Button>
          <Button variant="secondary" disabled={!selectedLead} onClick={() => resetLeads("current")}><RotateCcw size={16} /> Reset Current</Button>
          {user?.role === "ADMIN" && <Button variant="danger" onClick={() => setDeleteAllOpen(true)}><AlertTriangle size={16} /> Delete All Leads</Button>}
        </div>
      </div>

      {batch && (
        <div className={`${card} p-4`}>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-semibold">{batch.mode === "sending" ? "Bulk send progress" : "Batch progress"}</h2>
              <p className={`mt-1 text-sm ${textMuted}`}>{batch.running ? `${batch.mode === "sending" ? "Sending" : "Processing"} ${batch.current || "lead"}...` : batch.mode === "sending" ? "Bulk sending complete" : "Batch complete"}</p>
            </div>
            {batch.running && <Button variant="secondary" onClick={() => { cancelBatchRef.current = true; }}>Cancel</Button>}
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full bg-slate-950 transition-all dark:bg-white" style={{ width: `${batch.total ? (batch.completed / batch.total) * 100 : 0}%` }} />
          </div>
          {!batch.running && (
            <div className={`mt-4 grid gap-2 text-sm ${textMuted}`}>
              <p>{batch.approved || 0} completed successfully · {batch.rejected || 0} needs review · {batch.skipped || 0} skipped · {batch.errors || batch.failed || 0} failed</p>
              {batch.skippedReasons?.slice(0, 5).map((item) => <p key={item}>Skipped: {item}</p>)}
              {batch.failedReasons?.slice(0, 5).map((item) => <p key={item}>Failed: {item}</p>)}
            </div>
          )}
        </div>
      )}

      {replySyncProgress ? (
        <div className={`${card} p-4`}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{replySyncProgress.label}</p>
            <span className={`text-xs font-semibold ${textMuted}`}>{replySyncProgress.percent}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full bg-slate-950 transition-all duration-300 dark:bg-white" style={{ width: `${replySyncProgress.percent}%` }} />
          </div>
        </div>
      ) : null}

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
            <Select value={filters.emailStatus} onChange={(event) => setFilters({ ...filters, emailStatus: event.target.value })}>
              {emailStatusFilters.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}
            </Select>
            <Select value={filters.hasContactEmail} onChange={(event) => setFilters({ ...filters, hasContactEmail: event.target.value })}>
              {contactEmailFilters.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}
            </Select>
            <Select value={filters.followUpState} onChange={(event) => setFilters({ ...filters, followUpState: event.target.value })}>
              {followUpFilters.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}
            </Select>
            <Select value={filters.replyType} onChange={(event) => setFilters({ ...filters, replyType: event.target.value })}>
              {replyTypeFilters.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}
            </Select>
            <Select value={filters.actionState} onChange={(event) => setFilters({ ...filters, actionState: event.target.value })}>
              {actionFilters.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}
            </Select>
            <Button variant="secondary" disabled={!visibleLeads.length || batch?.running || sending} onClick={toggleSelectVisibleLeads}>
              {allVisibleSelected ? "Clear filtered selection" : "Select all filtered leads"}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={!selectedIds.length || batch?.running || sending} onClick={() => runBatch("selected")}>Run selected</Button>
              <Button variant="secondary" disabled={!visibleLeads.length || batch?.running || sending} onClick={() => runBatch("all")}>Run all</Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={!selectedIds.length || batch?.running || sending} onClick={() => analyzeServicesForBatch("selected")}>Analyze selected</Button>
              <Button variant="secondary" disabled={!visibleLeads.length || batch?.running || sending} onClick={() => analyzeServicesForBatch("all")}>Analyze services for all</Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={!selectedIds.length || batch?.running || sending} onClick={bulkApproveReports}>Approve selected reports</Button>
              <Button variant="secondary" disabled={!selectedIds.length || batch?.running || sending} onClick={sendSelectedEmails}>Send selected emails</Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={!selectedIds.length || batch?.running} onClick={() => generateFollowUpDraftsFor("selected")}>Generate selected follow-ups</Button>
              <Button variant="secondary" disabled={!visibleLeads.length || batch?.running} onClick={() => generateFollowUpDraftsFor("all")}>Generate filtered follow-ups</Button>
            </div>
            <details className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
              <summary className="cursor-pointer text-sm font-semibold">Batch workflow options</summary>
              <div className="mt-3 space-y-3">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={batchOptions.analyzeServicesIfMissing} onChange={() => setBatchOptions((current) => ({ ...current, analyzeServicesIfMissing: !current.analyzeServicesIfMissing }))} /> Analyze services if missing</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={batchOptions.generateReport} onChange={() => setBatchOptions((current) => ({ ...current, generateReport: !current.generateReport }))} /> Generate PDF reports</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={batchOptions.generateEmail} onChange={() => setBatchOptions((current) => ({ ...current, generateEmail: !current.generateEmail }))} /> Generate matching emails</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={batchOptions.runQualityGate} onChange={() => setBatchOptions((current) => ({ ...current, runQualityGate: !current.runQualityGate }))} /> Run quality gate</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={batchOptions.includeAttachmentWhenSending} onChange={() => setBatchOptions((current) => ({ ...current, includeAttachmentWhenSending: !current.includeAttachmentWhenSending }))} /> Attach approved PDFs when sending</label>
                <label className="flex items-center gap-3 text-sm">
                  <span className="font-medium">Concurrent leads</span>
                  <Input type="number" min="1" max="12" value={batchConcurrency} onChange={(event) => setBatchConcurrency(event.target.value)} className="w-24" />
                </label>
                <ReportServiceSelector value={batchReportServices} onChange={setBatchReportServices} label="Fallback services when no analyzed services are saved yet" />
              </div>
            </details>
          </div>
          <div className="mt-4 max-h-[calc(100vh-330px)] min-h-96 space-y-2 overflow-auto pr-1">
            {visibleLeads.map((lead) => {
              const state = pipelineState(lead);
              const leadReport = lead.auditReports?.[0] || null;
              const topServices = selectedServiceLabelsForLead(lead).slice(0, 3);
              const progressState = batchLeadProgress[lead.id];
              const progressLabel = overallLeadBatchStage(progressState);
              const emailState = leadEmailStatus(lead);
              const followUp = followUpState(lead);
              const replyBadge = replyClassificationBadge(lead);
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
                      <p className={`mt-2 truncate text-sm ${textMuted}`}>
                        Services: {topServices.length ? topServices.join(", ") : lead.serviceAnalysisStatus === "failed" ? "analysis failed" : lead.serviceAnalysisStatus === "analyzing" ? "analyzing..." : "not analyzed"}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {progressLabel ? (
                          <Badge className={progressState?.status === "failed" ? "bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-100 dark:ring-rose-800" : progressState?.status === "completed" ? "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-100 dark:ring-emerald-800" : "bg-blue-100 text-blue-800 ring-blue-200 dark:bg-blue-950/60 dark:text-blue-100 dark:ring-blue-800"}>
                            {progressLabel}
                          </Badge>
                        ) : null}
                        {statusBadge(state.status)}
                        {state.qualityScore && <Badge className="bg-white text-slate-700 ring-slate-200 dark:bg-slate-950 dark:text-slate-200 dark:ring-slate-700">Q {state.qualityScore}/10</Badge>}
                        <Badge className={lead.serviceAnalysisStatus === "completed" ? "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-100 dark:ring-emerald-800" : lead.serviceAnalysisStatus === "failed" ? "bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-100 dark:ring-rose-800" : "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700"}>
                          Services: {lead.serviceAnalysisStatus || "not_started"}
                        </Badge>
                        <Badge className={emailState === "REPLIED"
                          ? "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-100 dark:ring-emerald-800"
                          : emailState === "BOUNCED"
                            ? "bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-100 dark:ring-rose-800"
                          : emailState === "SENT"
                            ? "bg-blue-100 text-blue-800 ring-blue-200 dark:bg-blue-950/60 dark:text-blue-100 dark:ring-blue-800"
                            : emailState === "READY_TO_SEND"
                              ? "bg-violet-100 text-violet-800 ring-violet-200 dark:bg-violet-950/60 dark:text-violet-100 dark:ring-violet-800"
                              : emailState === "REJECTED"
                                ? "bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-100 dark:ring-rose-800"
                                : "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700"}>
                          Email: {emailState === "READY_TO_SEND" ? "approved" : emailState.toLowerCase().replaceAll("_", " ")}
                        </Badge>
                        <Badge className={leadReport?.status === "approved" || leadReport?.status === "attached" || leadReport?.status === "sent" ? "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-100 dark:ring-emerald-800" : leadReport?.status === "failed" || leadReport?.status === "failed_quality_gate" ? "bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-100 dark:ring-rose-800" : "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700"}>
                          Report: {leadReport?.status || "missing"}
                        </Badge>
                        <Badge className={followUp.className}>{followUp.label}</Badge>
                        {replyBadge ? <Badge className={replyBadge.className}>Reply: {replyBadge.label}</Badge> : null}
                        {lead.needsAction ? <Badge className="bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-100 dark:ring-amber-800">Needs action</Badge> : null}
                        {lead.doNotContact ? <Badge className="bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700">Do not contact</Badge> : null}
                        {progressState?.reportStatus === "running" ? <Badge className="bg-indigo-100 text-indigo-800 ring-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-100 dark:ring-indigo-800">Generating PDF</Badge> : null}
                        {progressState?.emailStatus === "running" ? <Badge className="bg-cyan-100 text-cyan-800 ring-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-100 dark:ring-cyan-800">Generating Email</Badge> : null}
                      </div>
                      {emailState === "REPLIED" && lead.lastReplySnippet ? (
                        <div className="mt-3 space-y-2">
                          <p className="line-clamp-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
                            {lead.lastReplySnippet}
                          </p>
                          {lead.gmailThreadId || lead.lastReplyMessageId ? (
                            <a
                              href={gmailReplyUrl(lead.gmailThreadId, lead.lastReplyMessageId)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-700 hover:text-emerald-900 dark:text-emerald-200 dark:hover:text-emerald-100"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <ArrowUpRight size={14} /> Open replied email
                            </a>
                          ) : null}
                        </div>
                      ) : null}
                      {progressState?.status === "failed" && progressState?.error ? <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">{progressState.error}</p> : null}
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
              <Button variant="secondary" disabled={!selectedLead || followUpDraftState.loading} onClick={generateSelectedLeadFollowUp}><FileText size={16} /> {followUpDraftState.loading ? "Generating..." : "Generate Follow-up Draft"}</Button>
              <Button variant="secondary" disabled={!selectedLead || !gmailReady} onClick={sendSelectedLeadFollowUp}><Send size={16} /> Send Follow-up</Button>
              <Button variant="secondary" disabled={!selectedLead || !gmailReady} onClick={sendSelectedLeadFollowUpNow}><Send size={16} /> Send Follow-up Now</Button>
              <Button variant="secondary" disabled={!currentResult} onClick={() => decide("REJECTED")}><XCircle size={16} /> Reject</Button>
              <Button variant="secondary" disabled={!selectedLead} onClick={() => resetLeads("current")}><RotateCcw size={16} /> Reset</Button>
            </div>
          </section>

          <Panel title="Follow-up">
            {selectedLead ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={followUpState(selectedLead).className}>{followUpState(selectedLead).label}</Badge>
                  {selectedLead.nextFollowUpAt ? <span className={`text-sm ${textMuted}`}>Next: {formatDate(selectedLead.nextFollowUpAt)}</span> : null}
                </div>
                {selectedLead.followUpStoppedReason ? <p className={`text-sm ${textMuted}`}>Stopped reason: {selectedLead.followUpStoppedReason.replaceAll("_", " ")}</p> : null}
                {selectedLead.outreachDrafts?.[0]?.type?.startsWith?.("FOLLOW_UP") ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{selectedLead.outreachDrafts[0].type.replaceAll("_", " ")}</p>
                    <p className="mt-2 font-semibold">{selectedLead.outreachDrafts[0].subject || "No subject"}</p>
                    <p className={`mt-2 line-clamp-5 text-sm leading-6 ${textMuted}`}>{selectedLead.outreachDrafts[0].fullMessage}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => setFollowUpDraftState({
                        loading: false,
                        saving: false,
                        open: true,
                        draftId: selectedLead.outreachDrafts[0].id || "",
                        subject: selectedLead.outreachDrafts[0].subject || "",
                        body: selectedLead.outreachDrafts[0].fullMessage || "",
                        type: selectedLead.outreachDrafts[0].type || ""
                      })}>Preview & Edit</Button>
                    </div>
                  </div>
                ) : (
                  <p className={`text-sm ${textMuted}`}>No follow-up draft generated yet for this lead.</p>
                )}
                {followUpDraftState.open ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950/60">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{followUpDraftState.type?.replaceAll("_", " ") || "Follow-up draft"}</p>
                    <label className="mt-3 block">
                      <span className="mb-1.5 block text-sm font-medium">Subject</span>
                      <Input value={followUpDraftState.subject} onChange={(event) => setFollowUpDraftState((current) => ({ ...current, subject: event.target.value }))} />
                    </label>
                    <label className="mt-3 block">
                      <span className="mb-1.5 block text-sm font-medium">Body</span>
                      <Textarea rows={12} value={followUpDraftState.body} onChange={(event) => setFollowUpDraftState((current) => ({ ...current, body: event.target.value }))} />
                    </label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="secondary" disabled={followUpDraftState.saving} onClick={saveFollowUpDraftEdit}>{followUpDraftState.saving ? "Saving..." : "Save draft edits"}</Button>
                      <Button variant="ghost" onClick={() => setFollowUpDraftState({ loading: false, saving: false, open: false, draftId: "", subject: "", body: "", type: "" })}>Close preview</Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : <p className={`text-sm ${textMuted}`}>Select a lead to manage follow-ups.</p>}
          </Panel>

          <Panel title="Business summary">
            <p className={`text-sm leading-6 ${textMuted}`}>{currentResult?.debug?.businessSummary || selectedLead?.scanEvidence?.businessUnderstanding?.summary || "Run the pipeline to capture the business context used for outreach."}</p>
          </Panel>

          <details className={`${card} p-5`}>
            <summary className="cursor-pointer text-lg font-semibold">Email basis</summary>
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
              ) : <p className={`text-sm ${textMuted}`}>This email is being generated from the analyzed services and selected report focus.</p>}
            </div>
          </details>

          <Panel title="Quality gate">
            {qualityGate ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {qualityGate.approved ? <CheckCircle className="text-emerald-600 dark:text-emerald-300" size={18} /> : <XCircle className="text-rose-600 dark:text-rose-300" size={18} />}
                  <span className="font-semibold">{qualityGate.approved ? "Approved" : "Rejected"}</span>
                  {Number.isFinite(Number(qualityGate.qualityScore)) ? <Badge className={qualityGate.approved ? workflowClasses.APPROVED : workflowClasses.REJECTED}>Quality {qualityGate.qualityScore}/10</Badge> : null}
                </div>
                <p className={`text-sm leading-6 ${textMuted}`}>{qualityGate.reason}</p>
                {previewQualityGate ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Live preview</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge className={previewQualityGate.approved ? workflowClasses.APPROVED : workflowClasses.REJECTED}>
                        {previewQualityGate.approved ? "Would pass" : "Would fail"} · {previewQualityGate.qualityScore}/10
                      </Badge>
                    </div>
                    <p className={`mt-2 text-sm leading-6 ${textMuted}`}>{previewQualityGate.reason}</p>
                  </div>
                ) : null}
              </div>
            ) : <p className={`text-sm ${textMuted}`}>Quality Gate has not run for this lead yet.</p>}
          </Panel>

          <Panel title="Reply detected">
            {selectedLead?.repliedAt ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-100 dark:ring-emerald-800">Replied</Badge>
                  <span className={`text-sm ${textMuted}`}>{formatDate(selectedLead.repliedAt)}</span>
                  {selectedLead.replyClassification ? <Badge className="bg-blue-100 text-blue-800 ring-blue-200 dark:bg-blue-950/60 dark:text-blue-100 dark:ring-blue-800">{selectedLead.replyClassification.toLowerCase().replaceAll("_", " ")}</Badge> : null}
                  {selectedLead.needsAction ? <Badge className="bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-100 dark:ring-amber-800">Needs action</Badge> : null}
                </div>
                <p className={`text-sm leading-6 ${textMuted}`}><span className="font-semibold text-slate-900 dark:text-slate-100">From:</span> {selectedLead.lastReplyFrom || "Unknown sender"}</p>
                <p className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 dark:border-slate-800 dark:bg-slate-950/60 ${textMuted}`}>{selectedLead.lastReplySnippet || "No snippet captured."}</p>
                {selectedLead.suggestedNextAction ? <p className={`text-sm leading-6 ${textMuted}`}><span className="font-semibold text-slate-900 dark:text-slate-100">Suggested next step:</span> {selectedLead.suggestedNextAction}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={classifySelectedReply}><RefreshCw size={16} /> Classify Reply</Button>
                  <Button variant="secondary" onClick={generateSelectedReplyDraft} disabled={replyDraftLoading}><FileText size={16} /> Generate Reply Draft</Button>
                </div>
                {replyDraft ? <pre className={`whitespace-pre-wrap rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 dark:border-slate-800 dark:bg-slate-950/60 ${textMuted}`}>{replyDraft}</pre> : null}
                {selectedLead.gmailThreadId || selectedLead.lastReplyMessageId ? <a href={gmailReplyUrl(selectedLead.gmailThreadId, selectedLead.lastReplyMessageId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-slate-950 dark:text-slate-200 dark:hover:text-white"><ArrowUpRight size={15} /> Open replied email</a> : null}
              </div>
            ) : <p className={`text-sm ${textMuted}`}>No reply has been synced for this lead yet.</p>}
          </Panel>

          <Panel title="Report">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={report?.qualityPassed ? workflowClasses.APPROVED : report?.status === "failed_quality_gate" ? workflowClasses.NEEDS_REVIEW : workflowClasses.NOT_ANALYSED}>
                  {report?.status || (reportLoading ? "loading" : "missing")}
                </Badge>
                {report?.opportunityScore != null && <Badge className="bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700">Opportunity {report.opportunityScore}/10</Badge>}
                {report?.confidenceScore != null && <Badge className="bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700">Confidence {report.confidenceScore}/100</Badge>}
              </div>
              <p className={`text-sm leading-6 ${textMuted}`}>{report?.summary || "Generate a website opportunity report to attach something concrete and useful with the outreach email."}</p>
              <ReportServiceSelector value={reportServices} onChange={changeSelectedLeadServices} analysisTarget={selectedLead} onAnalyze={() => selectedLead && analyzeServicesForLead(selectedLead)} />
              <div className="flex flex-wrap gap-2">
                {reportServices.map((serviceId) => (
                  <Badge key={serviceId} className="bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700">{serviceLabelsById[serviceId] || serviceId}</Badge>
                ))}
              </div>
              <div className={`rounded-2xl border p-4 ${reportReady ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100" : "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60"}`}>
                <p className="text-sm font-semibold">Attachment status</p>
                <p className="mt-1 text-sm">{reportReady ? `This report is approved and can be attached when you send. Focus: ${selectedReportFocus || "selected services"}.` : "This lead does not have an approved attachable report yet."}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={reportAction === "generate" || reportAction === "regenerate"} onClick={() => generateReportForSelected("generate")}><FileText size={16} /> {reportAction === "generate" ? "Generating..." : "Generate Report"}</Button>
                <Button
                  variant="secondary"
                  disabled={!report?.previewUrl || !report?.downloadUrl || !["generated", "approved", "attached", "sent"].includes(report?.status || "")}
                  onClick={openAndDownloadReport}
                >
                  Open & Download PDF
                </Button>
                <Button variant="secondary" disabled={reportAction === "generate" || reportAction === "regenerate"} onClick={() => generateReportForSelected("regenerate")}>{reportAction === "regenerate" ? "Regenerating..." : "Regenerate"}</Button>
                <Button variant="secondary" disabled={!report?.qualityPassed || reportAction === "approve"} onClick={approveSelectedReport}>{reportAction === "approve" ? "Approving..." : "Approve Report"}</Button>
              </div>
              {report?.qualityGate?.failedChecks?.length ? <p className="text-sm text-amber-700 dark:text-amber-300">Quality gate: {report.qualityGate.failedChecks.join(", ")}</p> : null}
              {reportServiceMismatch ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                  The approved report is out of sync with the currently selected services. Regenerate and approve the report before attaching it.
                </div>
              ) : null}
              {emailServiceMismatch ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                  Email does not match the selected report services. Regenerate email before sending.
                </div>
              ) : null}
              {report?.serviceSections?.length ? (
                <div className="space-y-3">
                  {report.serviceSections.map((section, index) => (
                    <div key={section.serviceId || index} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                      <p className="font-semibold">{section.serviceLabel}</p>
                      <p className={`mt-1 text-sm ${textMuted}`}>{section.serviceSummary}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
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
              {currentState.status === "NO_SUITABLE_ANGLE" && <Notice tone="orange">Automatic angle selection was too strict for this lead. Review or rewrite the strongest available draft below.</Notice>}
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
                  placeholder={currentState.status === "NO_SUITABLE_ANGLE" ? "Review or rewrite the draft email body here..." : "Edit the generated email body..."}
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

              <div className={soft + " p-4"}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Attachment</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{includeReport && reportReady ? attachmentFocusText : "Email will send without a report attachment."}</p>
                    <p className={`mt-1 text-sm ${textMuted}`}>
                      {reportReady
                        ? (reportServiceMismatch
                          ? "The attachment is blocked until the approved report matches the currently selected services."
                          : "You can still turn the attachment off for this send.")
                        : "Generate and approve a report first if you want to attach one."}
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={includeReport && reportReady}
                      disabled={!reportReady || reportServiceMismatch}
                      onChange={(event) => setIncludeReport(event.target.checked)}
                    />
                    Attach report
                  </label>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="secondary" disabled={savingDraft} onClick={saveDraft}><Clipboard size={16} /> {savingDraft ? "Saving..." : "Save Draft"}</Button>
                <Button variant="secondary" disabled={!draft.subject && !draft.body} onClick={() => copyText(fullEmail, "Email copied")}><Clipboard size={16} /> Copy Email</Button>
                <Button variant="secondary" disabled={!selectedLead || Boolean(runningLeadId)} onClick={() => runPipeline()}><RefreshCw size={16} /> Regenerate</Button>
                <Button disabled={sending || !gmailReady || !draft.subject || !draft.body || emailServiceMismatch || (reportServiceMismatch && includeReport)} onClick={sendEmail}><Send size={16} /> {currentState.status === "APPROVED" ? "Send" : "Send Anyway"}</Button>
              </div>
              {singleSendProgress ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{singleSendProgress.label}</p>
                    <span className={`text-xs font-semibold ${singleSendProgress.error ? "text-rose-600 dark:text-rose-300" : "text-slate-500 dark:text-slate-400"}`}>{singleSendProgress.percent}%</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                    <div className={`h-full transition-all ${singleSendProgress.error ? "bg-rose-500" : "bg-slate-950 dark:bg-white"}`} style={{ width: `${singleSendProgress.percent || 0}%` }} />
                  </div>
                </div>
              ) : null}
              {emailServiceMismatch || (reportServiceMismatch && includeReport) ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                  {emailServiceMismatch
                    ? "Email does not match the selected report services. Regenerate email before sending."
                    : "The approved PDF report does not match the currently selected services. Regenerate and approve the report before sending."}
                </div>
              ) : null}

              <div className={soft + " p-3"}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Send test email</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="your@email.com" />
                  <Button variant="secondary" disabled={sendingTest || !gmailReady || !draft.subject || !draft.body || emailServiceMismatch || (reportServiceMismatch && includeReport)} onClick={sendTestEmail}>{sendingTest ? "Sending..." : "Send Test"}</Button>
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
