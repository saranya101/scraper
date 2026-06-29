import { ArrowLeft, ArrowUpRight, Clipboard, Cpu, DollarSign, GitCompare, Globe2, History, Mail, MailCheck, MailPlus, MapPin, MessageCircle, Pencil, Phone, Plus, Search, ShieldCheck, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import LeadFormModal from "../components/LeadFormModal.jsx";
import ScreenshotPreview from "../components/ScreenshotPreview.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Input, Select, Textarea } from "../components/ui/Input.jsx";
import { useToast } from "../hooks/useToast.jsx";
import { api } from "../services/api.js";
import { domain, formatDate, pipelineStages, priorities, statuses, websiteStatuses } from "../utils/format.js";

const techGroups = [
  ["Analytics", [["GA4", "analyticsGa4"], ["GTM", "analyticsGtm"], ["Meta Pixel", "analyticsMetaPixel"]]],
  ["Booking", [["Calendly", "bookingCalendly"], ["SimplyBook", "bookingSimplyBook"], ["Acuity", "bookingAcuity"]]],
  ["Marketing", [["Mailchimp", "marketingMailchimp"], ["HubSpot", "marketingHubspot"], ["Klaviyo", "marketingKlaviyo"]]],
  ["Chat", [["Intercom", "chatIntercom"], ["Tawk.to", "chatTawk"], ["Zendesk", "chatZendesk"]]]
];

const evidenceOrder = [
  "phoneVisible",
  "emailVisible",
  "whatsappLinkPresent",
  "contactFormPresent",
  "bookingFormPresent",
  "servicePagesPresent",
  "projectCaseStudyPagesPresent",
  "socialLinksPresent",
  "basicSeoPresent",
  "pageSpeedUsable",
  "techStackDetected",
  "awardsVisible",
  "trustBadgesVisible",
  "certificationsVisible",
  "testimonialsVisible",
  "reviewsVisible",
  "ctaVisible",
  "firstCtaScrollDepth",
  "awardsBadgesScrollDepth",
  "portfolioProjectVisuals",
  "beforeAfterVisuals"
];

function contactRows(lead) {
  return [
    ["General email", lead.generalEmail],
    ["Owner email", lead.ownerEmail],
    ["LinkedIn", lead.linkedinCompany],
    ["Instagram", lead.instagram],
    ["Facebook", lead.facebook],
    ["WhatsApp", lead.whatsapp]
  ].filter(([, value]) => value);
}

function money(value) {
  return value == null || value === "" ? "-" : `$${Number(value || 0).toLocaleString()}`;
}

function fixTitle(fix) {
  return typeof fix === "string" ? fix : fix.title || fix.details || "Recommended fix";
}

function fixMeta(fix, key) {
  return typeof fix === "string" ? null : fix[key];
}

function evidenceBadgeClass(value) {
  if (value === "present") return "bg-emerald-100 text-emerald-800 ring-emerald-200";
  if (value === "absent") return "bg-rose-100 text-rose-700 ring-rose-200";
  return "bg-slate-100 text-slate-700 ring-slate-200";
}

export default function LeadDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { push } = useToast();
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [drafts, setDrafts] = useState([]);
  const [emailHistory, setEmailHistory] = useState({ connectedAccounts: [], lastContactedAt: null, sends: [] });
  const [competitorData, setCompetitorData] = useState({ competitors: [], salesAngle: "", leadScore: null });
  const [revenueForm, setRevenueForm] = useState({});
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [competitorLoading, setCompetitorLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState("");
  const [editingNote, setEditingNote] = useState("");
  const [evidence, setEvidence] = useState(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [correctionDrafts, setCorrectionDrafts] = useState({});

  async function loadLead() {
    setLoading(true);
    try {
      const { data } = await api.get(`/leads/${id}`);
      setLead(data);
      setRevenueForm({
        estimatedMinValue: data.estimatedMinValue ?? "",
        estimatedMaxValue: data.estimatedMaxValue ?? "",
        actualRevenue: data.actualRevenue ?? "",
        profit: data.profit ?? "",
        monthlyRetainer: data.monthlyRetainer ?? "",
        annualRetainer: data.annualRetainer ?? "",
        paymentStatus: data.paymentStatus || "",
        wonAt: data.wonAt ? data.wonAt.slice(0, 10) : ""
      });
    } catch (error) {
      push(error.response?.data?.message || "Could not load lead", "error");
      navigate("/");
    } finally {
      setLoading(false);
    }
  }

  async function loadDrafts() {
    const { data } = await api.get(`/outreach/${id}`);
    setDrafts(data);
  }

  async function loadCompetitors() {
    const { data } = await api.get(`/competitors/${id}`);
    setCompetitorData(data);
  }

  async function loadEmailHistory() {
    const { data } = await api.get(`/email/history/${id}`);
    setEmailHistory(data);
  }

  async function loadEvidence() {
    const { data } = await api.get(`/evidence/${id}`);
    setEvidence(data);
  }

  useEffect(() => {
    loadLead();
  }, [id]);

  useEffect(() => {
    loadDrafts().catch(() => {});
    loadCompetitors().catch(() => {});
    loadEmailHistory().catch(() => {});
    loadEvidence().catch(() => {});
  }, [id]);

  async function updateStatus(status) {
    const { data } = await api.put(`/leads/${id}`, { ...lead, status, issues: lead.issues.map((issue) => issue.issueText) });
    setLead(data);
    push("Status updated");
  }

  async function saveLead(payload) {
    const { data } = await api.put(`/leads/${id}`, payload);
    setLead(data);
    push("Lead updated");
  }

  async function saveRevenue(event) {
    event.preventDefault();
    const payload = Object.fromEntries(Object.entries(revenueForm).map(([key, value]) => [key, value === "" ? null : value]));
    const { data } = await api.put(`/leads/${id}`, {
      ...payload,
      wonAt: payload.wonAt ? new Date(payload.wonAt).toISOString() : null
    });
    setLead(data);
    push("Revenue updated");
  }

  async function addNote(event) {
    event.preventDefault();
    if (!note.trim()) return;
    await api.post("/notes", { leadId: id, note });
    setNote("");
    push("Note added");
    loadLead();
  }

  async function updateNote(noteId) {
    if (!editingNote.trim()) return;
    await api.put(`/notes/${noteId}`, { note: editingNote });
    setEditingNoteId("");
    setEditingNote("");
    push("Note updated");
    loadLead();
  }

  async function deleteNote(noteId) {
    if (!confirm("Delete this note?")) return;
    await api.delete(`/notes/${noteId}`);
    push("Note deleted");
    loadLead();
  }

  async function copyOutreach() {
    await navigator.clipboard.writeText(lead.outreachEmail || "");
    push("Outreach copied");
  }

  async function copyContact(value) {
    await navigator.clipboard.writeText(value || "");
    push("Contact copied");
  }

  async function generateOutreach() {
    setGeneratingDraft(true);
    try {
      const { data } = await api.post(`/outreach/generate/${id}`, { type: "EMAIL", tone: "consultative" });
      await navigator.clipboard.writeText(data.fullMessage || "");
      push("Outreach generated and copied");
      await Promise.all([loadLead(), loadDrafts()]);
    } catch (error) {
      push(error.response?.data?.message || "Could not generate outreach", "error");
    } finally {
      setGeneratingDraft(false);
    }
  }

  async function copyDraft(draft) {
    await navigator.clipboard.writeText(draft.fullMessage || "");
    await api.put(`/outreach/${draft.id}`, { status: "COPIED" });
    push("Draft copied");
    loadDrafts();
  }

  async function findCompetitors() {
    setCompetitorLoading(true);
    try {
      const { data } = await api.post(`/competitors/find/${id}`);
      setCompetitorData(data);
      push("Competitors found");
    } catch (error) {
      push(error.response?.data?.message || "Could not find competitors", "error");
    } finally {
      setCompetitorLoading(false);
    }
  }

  async function auditCompetitors() {
    setCompetitorLoading(true);
    try {
      const { data } = await api.post(`/competitors/audit/${id}`);
      setCompetitorData(data);
      push("Competitor audit saved");
    } catch (error) {
      push(error.response?.data?.message || "Could not audit competitors", "error");
    } finally {
      setCompetitorLoading(false);
    }
  }

  async function copySalesAngle() {
    await navigator.clipboard.writeText(competitorData.salesAngle || "");
    push("Sales angle copied");
  }

  async function removeLead() {
    if (!confirm(`Delete ${lead.company}?`)) return;
    await api.delete(`/leads/${id}`);
    push("Lead deleted");
    navigate("/");
  }

  async function reprocessOpportunities() {
    const { data } = await api.post(`/leads/${id}/reprocess-opportunities`);
    setLead({ ...lead, serviceOpportunities: data });
    push("Service opportunities refreshed");
    loadLead();
  }

  async function runEvidenceScan(mode) {
    setEvidenceLoading(true);
    try {
      const { data } = await api.post(`/evidence/${id}/${mode}`);
      setLead(data);
      await loadEvidence();
      push(mode === "vision" ? "Vision evidence scan saved" : "Cheap evidence scan saved");
    } catch (error) {
      push(error.response?.data?.message || "Could not run evidence scan", "error");
    } finally {
      setEvidenceLoading(false);
    }
  }

  async function saveEvidenceCorrection(signalKey) {
    const draft = correctionDrafts[signalKey] || {};
    if (!draft.value) return push("Choose present, absent, or unknown first", "error");
    const { data } = await api.post(`/evidence/${id}/corrections`, {
      signalKey,
      value: draft.value,
      notes: draft.notes || ""
    });
    setEvidence((current) => ({
      ...(current || {}),
      corrections: [
        data,
        ...((current?.corrections || []).filter((item) => item.signalKey !== signalKey))
      ]
    }));
    push("Evidence correction saved");
  }

  if (loading || !lead) return <div className="rounded-3xl border border-slate-200 bg-white p-10 text-slate-500">Loading lead...</div>;

  const scoreRows = [
    ["Design", lead.visualDesignScore],
    ["Mobile", lead.mobileScore],
    ["Trust", lead.trustScore],
    ["CTA", lead.ctaScore],
    ["SEO", lead.seoScore],
    ["Conversion", lead.conversionScore || lead.opportunityScore],
    ["Speed", lead.speedScore],
    ["Booking", lead.bookingScore],
    ["Analytics", lead.analyticsScore],
    ["Contactability", lead.contactabilityScore || (lead.contactConfidence ? Math.round(lead.contactConfidence / 10) : null)]
  ];
  const evidencePayload = evidence?.scanEvidence || lead.scanEvidence || {};
  const evidenceSignals = evidencePayload.signals || {};
  const correctionsBySignal = Object.fromEntries((evidence?.corrections || lead.evidenceCorrections || []).map((item) => [item.signalKey, item]));
  const orderedEvidence = [
    ...evidenceOrder.filter((key) => evidenceSignals[key]),
    ...Object.keys(evidenceSignals).filter((key) => !evidenceOrder.includes(key))
  ].map((key) => evidenceSignals[key]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <Link to="/" className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-950">
            <ArrowLeft size={16} /> Back to leads
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{lead.company}</h1>
            <Badge className={priorities[lead.priority]?.className}>{priorities[lead.priority]?.label}</Badge>
            <Badge className={statuses[lead.status]?.className}>{statuses[lead.status]?.label}</Badge>
            <Badge className={websiteStatuses[lead.websiteStatus]?.className}>{websiteStatuses[lead.websiteStatus]?.label}</Badge>
          </div>
          <a href={lead.website} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-950">
            {domain(lead.website)} <ArrowUpRight size={13} />
          </a>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/outreach?leadId=${lead.id}`} className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-slate-900 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
            <Mail size={16} /> Open in Outreach Pipeline
          </Link>
          <Button variant="secondary" onClick={() => setModalOpen(true)}><Pencil size={16} /> Edit</Button>
          <Button variant="danger" onClick={removeLead}><Trash2 size={16} /> Delete</Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="min-w-0 space-y-6">
          <div className="min-w-0 max-w-full overflow-hidden rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="min-w-0 max-w-full bg-[linear-gradient(135deg,#f8fafc,#e2e8f0)]">
              {lead.screenshotPath ? (
                <ScreenshotPreview
                  src={lead.screenshotPath}
                  alt={`${lead.company} website screenshot`}
                  variant="scroll"
                  className="rounded-2xl"
                />
              ) : (
                <div className="grid min-h-64 place-items-center p-8 text-center">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">Screenshot preview</p>
                    <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-800">Add a website screenshot path when audits are generated.</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_220px]">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold">Score breakdown</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                {scoreRows.map(([label, value]) => (
                  <div key={label} className="rounded-2xl bg-slate-50 p-3">
                    <p className="text-xs text-slate-400">{label}</p>
                    <p className="mt-1 text-2xl font-semibold">{value || "-"}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
              <p className="mb-2 text-sm font-semibold">Mobile screenshot</p>
              {lead.mobileScreenshotPath
                ? <ScreenshotPreview src={lead.mobileScreenshotPath} alt={`${lead.company} mobile screenshot`} variant="contain" className="rounded-2xl" />
                : <div className="grid h-[320px] place-items-center rounded-2xl bg-slate-100 px-4 text-center text-sm text-slate-400 sm:h-[420px]">No mobile screenshot</div>}
            </div>
          </div>

          <form onSubmit={saveRevenue} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold"><DollarSign size={18} /> Revenue tracking</h2>
                <p className="mt-1 text-sm text-slate-500">Track project value, cash collected, retainers, and close date.</p>
              </div>
              <Button>Save revenue</Button>
            </div>
            <div className="mb-5 grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl bg-slate-950 p-4 text-white">
                <p className="text-xs uppercase tracking-wide text-slate-400">Estimated range</p>
                <p className="mt-2 text-xl font-semibold">{money(revenueForm.estimatedMinValue)} - {money(revenueForm.estimatedMaxValue)}</p>
              </div>
              <div className="rounded-2xl bg-emerald-50 p-4 text-emerald-950">
                <p className="text-xs uppercase tracking-wide text-emerald-700">Actual revenue</p>
                <p className="mt-2 text-xl font-semibold">{money(revenueForm.actualRevenue)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">Profit</p>
                <p className="mt-2 text-xl font-semibold">{money(revenueForm.profit)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">Annual retainer</p>
                <p className="mt-2 text-xl font-semibold">{money(revenueForm.annualRetainer)}</p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              {[
                ["Min value", "estimatedMinValue"],
                ["Max value", "estimatedMaxValue"],
                ["Actual revenue", "actualRevenue"],
                ["Profit", "profit"],
                ["Monthly retainer", "monthlyRetainer"],
                ["Annual retainer", "annualRetainer"]
              ].map(([label, key]) => (
                <label key={key}>
                  <span className="mb-1.5 block text-sm font-medium">{label}</span>
                  <Input type="number" min={key === "profit" ? undefined : "0"} value={revenueForm[key] || ""} onChange={(event) => setRevenueForm({ ...revenueForm, [key]: event.target.value })} />
                </label>
              ))}
              <label>
                <span className="mb-1.5 block text-sm font-medium">Payment status</span>
                <Select value={revenueForm.paymentStatus || ""} onChange={(event) => setRevenueForm({ ...revenueForm, paymentStatus: event.target.value })}>
                  <option value="">Not set</option>
                  <option value="UNPAID">Unpaid</option>
                  <option value="DEPOSIT_PAID">Deposit paid</option>
                  <option value="PAID">Paid</option>
                  <option value="OVERDUE">Overdue</option>
                </Select>
              </label>
              <label>
                <span className="mb-1.5 block text-sm font-medium">Won at</span>
                <Input type="date" value={revenueForm.wonAt || ""} onChange={(event) => setRevenueForm({ ...revenueForm, wonAt: event.target.value })} />
              </label>
            </div>
          </form>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Audit issues</h2>
              <div className="rounded-full bg-slate-950 px-3 py-1 text-sm font-semibold text-white">{lead.score}/10</div>
            </div>
            {lead.issues.length ? (
              <ul className="space-y-3">
                {lead.issues.map((issue) => (
                  <li key={issue.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">{issue.issueText}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No issues recorded yet.</p>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck size={18} /> Evidence collector V2</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Verified DOM, PageSpeed, and selected full-page visual signals. Unknown stays neutral until reviewed.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => runEvidenceScan("cheap")} disabled={evidenceLoading}>
                  {evidenceLoading ? "Scanning..." : "Run cheap scan"}
                </Button>
                <Button onClick={() => runEvidenceScan("vision")} disabled={evidenceLoading}>
                  {evidenceLoading ? "Scanning..." : "Run vision scan"}
                </Button>
              </div>
            </div>

            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Detector</p>
                <p className="mt-1 font-semibold">{evidencePayload.detectorVersion || "Not scanned"}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Last scan</p>
                <p className="mt-1 font-semibold">{evidencePayload.visionScannedAt ? formatDate(evidencePayload.visionScannedAt) : evidencePayload.scannedAt ? formatDate(evidencePayload.scannedAt) : "Not scanned"}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Review status</p>
                <p className="mt-1 font-semibold">{evidencePayload.reviewRequired ? "Needs review" : evidencePayload.status || "Not scanned"}</p>
              </div>
            </div>

            {evidencePayload.fullPageScreenshotPath && (
              <div className="mb-5">
                <p className="mb-2 text-sm font-semibold">Full-page evidence screenshot</p>
                <ScreenshotPreview
                  src={evidencePayload.fullPageScreenshotPath}
                  alt={`${lead.company} full-page evidence screenshot`}
                  variant="scroll"
                />
              </div>
            )}

            {orderedEvidence.length ? (
              <div className="space-y-3">
                {orderedEvidence.map((signal) => {
                  const correction = correctionsBySignal[signal.key];
                  const draft = correctionDrafts[signal.key] || {};
                  const effectiveValue = correction?.value || signal.value;
                  return (
                    <div key={signal.key} className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-slate-950">{signal.label || signal.key}</p>
                            <Badge className={evidenceBadgeClass(effectiveValue)}>{effectiveValue}</Badge>
                            {correction && <Badge className="bg-indigo-100 text-indigo-800 ring-indigo-200">Manual truth</Badge>}
                          </div>
                          <p className="mt-2 text-sm leading-6 text-slate-600">{correction?.notes || signal.evidence}</p>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <Badge className="bg-white text-slate-700 ring-slate-200">{signal.source}</Badge>
                          <Badge className="bg-white text-slate-700 ring-slate-200">{Math.round((signal.confidence || 0) * 100)}% confidence</Badge>
                          {signal.scrollDepth != null && <Badge className="bg-white text-slate-700 ring-slate-200">{Math.round(signal.scrollDepth * 100)}% depth</Badge>}
                        </div>
                      </div>
                      <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                        <div className="min-w-0 space-y-2 text-sm text-slate-600">
                          {signal.textRead && <p className="max-w-full break-words rounded-xl bg-white px-3 py-2 [overflow-wrap:anywhere]"><span className="font-semibold text-slate-900">Text read:</span> {signal.textRead}</p>}
                          {signal.region && <p className="rounded-xl bg-white px-3 py-2"><span className="font-semibold text-slate-900">Screenshot region:</span> [{signal.region.join(", ")}]</p>}
                          <p className="rounded-xl bg-white px-3 py-2"><span className="font-semibold text-slate-900">Detector:</span> {signal.detectorVersion}</p>
                        </div>
                        <div className="min-w-0 space-y-2">
                          <Select value={draft.value ?? correction?.value ?? ""} onChange={(event) => setCorrectionDrafts({ ...correctionDrafts, [signal.key]: { ...draft, value: event.target.value } })}>
                            <option value="">Manual correction</option>
                            <option value="present">Present</option>
                            <option value="absent">Absent</option>
                            <option value="unknown">Unknown</option>
                          </Select>
                          <Textarea className="min-h-20" value={draft.notes ?? correction?.notes ?? ""} onChange={(event) => setCorrectionDrafts({ ...correctionDrafts, [signal.key]: { ...draft, notes: event.target.value } })} placeholder="Optional reviewer notes" />
                          <Button type="button" variant="secondary" className="w-full" onClick={() => saveEvidenceCorrection(signal.key)}>Save correction</Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
                No evidence collected yet. Run a cheap scan for DOM/PageSpeed facts, then vision scan only for selected high-value leads.
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Recommended fixes</h2>
            {Array.isArray(lead.recommendedFixes) && lead.recommendedFixes.length ? (
              <div className="space-y-3">
                {lead.recommendedFixes.map((fix, index) => (
                  <div key={index} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <p className="font-semibold text-slate-950">{fixTitle(fix)}</p>
                      <div className="flex flex-wrap gap-2">
                        {fixMeta(fix, "priority") && <Badge className="bg-rose-50 text-rose-700 ring-rose-200">Priority: {fixMeta(fix, "priority")}</Badge>}
                        {fixMeta(fix, "impact") && <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200">Impact: {fixMeta(fix, "impact")}</Badge>}
                        {fixMeta(fix, "effort") && <Badge className="bg-amber-50 text-amber-700 ring-amber-200">Effort: {fixMeta(fix, "effort")}</Badge>}
                      </div>
                    </div>
                    {fixMeta(fix, "details") && <p className="text-sm leading-6 text-slate-600">{fixMeta(fix, "details")}</p>}
                    {fixMeta(fix, "serviceFit") && <p className="mt-3 rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-700">Service fit: {fixMeta(fix, "serviceFit")}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No recommended fixes saved yet.</p>
            )}
          </div>

        </section>

        <aside className="min-w-0 space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold"><MessageCircle size={18} /> Contact details</h2>
              <Badge className={(lead.contactConfidence || 0) >= 70 ? "bg-emerald-100 text-emerald-800 ring-emerald-200" : (lead.contactConfidence || 0) >= 45 ? "bg-amber-100 text-amber-800 ring-amber-200" : "bg-slate-100 text-slate-700 ring-slate-200"}>{lead.contactConfidence || 0}% confidence</Badge>
            </div>
            <div className="space-y-2">
              {contactRows(lead).map(([label, value]) => (
                <button key={label} onClick={() => copyContact(value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left hover:bg-slate-100">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                  <p className="mt-1 break-all text-sm font-medium text-slate-700">{value}</p>
                </button>
              ))}
              {!contactRows(lead).length && <p className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">No email or social contact found yet.</p>}
            </div>
            {lead.contactSource && <p className="mt-3 text-xs text-slate-400">Source: {lead.contactSource}</p>}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Cpu size={18} /> Technology stack</h2>
            <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">CMS / builder</p>
              <p className="mt-1 flex items-center gap-2 text-lg font-semibold capitalize"><Globe2 size={16} /> {lead.cms || "Unknown"}</p>
            </div>
            <div className="space-y-4">
              {techGroups.map(([group, items]) => (
                <div key={group}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{group}</p>
                  <div className="flex flex-wrap gap-2">
                    {items.map(([label, key]) => (
                      <Badge key={key} className={lead[key] ? "bg-emerald-100 text-emerald-800 ring-emerald-200" : "bg-slate-100 text-slate-500 ring-slate-200"}>
                        {lead[key] ? "Detected" : "Missing"}: {label}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Company details</h2>
            <div className="space-y-3 text-sm text-slate-600">
              <p className="flex gap-2"><Phone size={16} /> {lead.phone || "No phone"}</p>
              <p className="flex gap-2"><MapPin size={16} /> {lead.address || "No address"}</p>
              <p className="flex gap-2"><Mail size={16} /> {lead.industry || "No industry"}</p>
              <p className="rounded-2xl bg-slate-50 p-3">Website check: {websiteStatuses[lead.websiteStatus]?.label || "Unknown"}{lead.statusCode ? ` · HTTP ${lead.statusCode}` : ""}</p>
              {lead.accessIssueReason && <p className="rounded-2xl bg-amber-50 p-3 text-amber-800">{lead.accessIssueReason}</p>}
              {lead.estimatedProjectValue && <p className="rounded-2xl bg-emerald-50 p-3 text-emerald-800">Estimated value: {lead.estimatedProjectValue}</p>}
            </div>
            <label className="mt-5 block">
              <span className="mb-1.5 block text-sm font-medium">Status</span>
              <Select value={lead.status} onChange={(event) => updateStatus(event.target.value)}>
                <option value="NOT_CONTACTED">Not Contacted</option>
                <option value="CONTACTED">Contacted</option>
                <option value="REPLIED">Replied</option>
                <option value="CLOSED">Closed</option>
                <option value="ARCHIVED">Archived</option>
              </Select>
            </label>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Notes</h2>
            <form onSubmit={addNote} className="mb-5">
              <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a private note..." />
              <Button className="mt-3 w-full"><Plus size={16} /> Add note</Button>
            </form>
            <Button type="button" variant="secondary" className="w-full" onClick={() => setNotesOpen(true)}>
              Open full notes ({lead.notes.length})
            </Button>
            {lead.notes[0] ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="line-clamp-3 text-sm text-slate-700">{lead.notes[0].note}</p>
                <p className="mt-2 text-xs text-slate-400">{lead.notes[0].user.name} · {formatDate(lead.notes[0].createdAt)}</p>
              </div>
            ) : <p className="mt-3 text-sm text-slate-500">No notes yet.</p>}
          </div>

          <details className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <summary className="flex cursor-pointer items-center gap-2 text-lg font-semibold"><History size={18} /> Audit trail</summary>
            <div className="mt-4 space-y-4">
              {lead.statusHistory.map((item) => (
                <div key={item.id} className="border-l-2 border-slate-200 pl-4">
                  <p className="text-sm font-medium">
                    {pipelineStages[item.oldStage]?.label || statuses[item.oldStatus]?.label || "Created"} to {pipelineStages[item.newStage]?.label || statuses[item.newStatus]?.label}
                  </p>
                  <p className="text-xs text-slate-400">{item.user.name} · {formatDate(item.createdAt)}</p>
                </div>
              ))}
              {!lead.statusHistory.length && <p className="text-sm text-slate-500">No status changes yet.</p>}
            </div>
          </details>
        </aside>
      </div>

      <section className="space-y-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Service opportunities</h2>
              <p className="text-sm text-slate-500">What we should sell, estimated value, and why.</p>
            </div>
            <Button variant="secondary" onClick={reprocessOpportunities}>Reprocess</Button>
          </div>
          {lead.serviceOpportunities?.length ? (
            <div className="grid gap-3">
              {lead.serviceOpportunities.map((opportunity) => (
                <div key={opportunity.id} className={`rounded-2xl border p-4 ${opportunity.recommended ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
                  <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="font-semibold text-slate-950">{opportunity.service.name}</p>
                      {opportunity.recommended && <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">Recommended primary service</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className={opportunity.score >= 8 ? "bg-emerald-100 text-emerald-800 ring-emerald-200" : opportunity.score >= 6 ? "bg-amber-100 text-amber-800 ring-amber-200" : "bg-slate-100 text-slate-700 ring-slate-200"}>Score {opportunity.score}/10</Badge>
                      <Badge className="bg-slate-100 text-slate-700 ring-slate-200">Confidence {opportunity.confidence || "-"}%</Badge>
                    </div>
                  </div>
                  <p className="text-sm font-semibold text-slate-800">${opportunity.estimatedMinValue.toLocaleString()} - ${opportunity.estimatedMaxValue.toLocaleString()}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{opportunity.reason}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
              No service opportunities yet. Run reprocess to generate them for this lead.
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold"><GitCompare size={18} /> Competitor comparison</h2>
              <p className="mt-1 text-sm text-slate-500">Find local competitors, compare website scores, and use the sales angle in outreach.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={findCompetitors} disabled={competitorLoading}><Search size={16} /> Find</Button>
              <Button variant="secondary" onClick={auditCompetitors} disabled={competitorLoading || !competitorData.competitors.length}><GitCompare size={16} /> Audit</Button>
              <Button onClick={copySalesAngle} disabled={!competitorData.salesAngle}><Clipboard size={16} /> Copy angle</Button>
            </div>
          </div>

          <div className="mb-5 rounded-2xl bg-slate-950 p-5 text-slate-100">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">AI sales angle</p>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{competitorData.salesAngle || "Run competitor discovery to generate a comparison-based pitch."}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold">{lead.company}</p>
              <p className="mt-2 text-3xl font-semibold">{lead.score}<span className="text-base text-slate-400">/10</span></p>
              <p className="mt-1 text-xs text-slate-500">Lead website score</p>
            </div>
            {competitorData.competitors.map((competitor) => (
              <div key={competitor.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="bg-slate-100">
                  {competitor.screenshotPath ? (
                    <ScreenshotPreview
                      src={competitor.screenshotPath}
                      alt={`${competitor.company} website screenshot`}
                      variant="card"
                      className="rounded-none"
                    />
                  ) : (
                    <div className="grid h-full place-items-center px-4 text-center text-xs text-slate-400">Audit to capture screenshot</div>
                  )}
                </div>
                <div className="p-4">
                  <a href={competitor.website} target="_blank" rel="noreferrer" className="block truncate text-sm font-semibold hover:underline">{competitor.company}</a>
                  <p className="mt-2 text-3xl font-semibold">{competitor.score}<span className="text-base text-slate-400">/10</span></p>
                  <div className="mt-3 space-y-2 text-xs text-slate-600">
                    {(Array.isArray(competitor.strengths) ? competitor.strengths : []).slice(0, 2).map((item) => <p key={item} className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-800">{item}</p>)}
                    {(Array.isArray(competitor.weaknesses) ? competitor.weaknesses : []).slice(0, 1).map((item) => <p key={item} className="rounded-lg bg-amber-50 px-2 py-1 text-amber-800">{item}</p>)}
                  </div>
                </div>
              </div>
            ))}
            {!competitorData.competitors.length && (
              <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 md:col-span-3">
                No competitors saved yet. Use Find to pull three local competitors from Google Places.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Outreach workspace</h2>
              <p className="mt-1 text-sm text-slate-500">Contact intelligence plus the latest generated message.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={generateOutreach} disabled={generatingDraft}><MailPlus size={16} /> {generatingDraft ? "Generating..." : "Generate"}</Button>
              <Button variant="secondary" onClick={copyOutreach} disabled={!lead.outreachEmail}><Clipboard size={16} /> Copy</Button>
            </div>
          </div>
          <div className="mb-4 grid gap-3 md:grid-cols-2">
            {(contactRows(lead).slice(0, 4)).map(([label, value]) => (
              <button key={label} onClick={() => copyContact(value)} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:bg-slate-100">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                <p className="mt-1 truncate text-sm font-semibold text-slate-800">{value}</p>
              </button>
            ))}
            {!contactRows(lead).length && <p className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 md:col-span-2">No contact details captured yet. Run a full/deep scan to visit the contact page.</p>}
          </div>
          <pre className="whitespace-pre-wrap rounded-2xl bg-slate-950 p-5 text-sm leading-6 text-slate-100">{lead.outreachEmail || "No outreach copy saved yet."}</pre>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold"><MailCheck size={18} /> Email history</h2>
              <p className="mt-1 text-sm text-slate-500">
                {emailHistory.lastContactedAt ? `Last contacted ${formatDate(emailHistory.lastContactedAt)}` : "No sent email logged yet."}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Connected sender</p>
              <p className="mt-1 font-semibold">{emailHistory.connectedAccounts?.[0]?.email || "No email connected"}</p>
            </div>
          </div>
          <div className="space-y-3">
            {(emailHistory.sends || []).map((send) => (
              <div key={send.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-semibold">{send.subject}</p>
                    <p className="mt-1 text-sm text-slate-500">To {send.toEmail} from {send.emailAccount?.email || emailHistory.connectedAccounts?.[0]?.email || "hello@ocia.studio"}</p>
                  </div>
                  <Badge className={send.status === "SENT" ? "bg-emerald-100 text-emerald-800 ring-emerald-200" : send.status === "FAILED" ? "bg-rose-100 text-rose-700 ring-rose-200" : "bg-slate-100 text-slate-700 ring-slate-200"}>
                    {send.status}
                  </Badge>
                </div>
                <p className="text-xs text-slate-400">{send.sentAt ? `Sent ${formatDate(send.sentAt)}` : `Created ${formatDate(send.createdAt)}`}</p>
                {send.errorMessage && <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{send.errorMessage}</p>}
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-500">View body</summary>
                  <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-white p-4 text-sm leading-6 text-slate-700">{send.body}</pre>
                </details>
              </div>
            ))}
            {!emailHistory.sends?.length && <p className="rounded-2xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">No email sends for this lead yet.</p>}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Saved outreach drafts</h2>
            <Link to="/outreach" className="text-sm font-semibold text-slate-500 hover:text-slate-950">Open outreach</Link>
          </div>
          <div className="space-y-3">
            {drafts.map((draft) => (
              <div key={draft.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{draft.type.replaceAll("_", " ")}</p>
                    <p className="text-xs text-slate-400">{draft.status} · {formatDate(draft.updatedAt)}</p>
                  </div>
                  <Button variant="ghost" className="px-2.5" onClick={() => copyDraft(draft)}><Clipboard size={15} /></Button>
                </div>
                <p className="line-clamp-3 text-sm leading-6 text-slate-600">{draft.fullMessage}</p>
              </div>
            ))}
            {!drafts.length && <p className="text-sm text-slate-500">No saved drafts yet.</p>}
          </div>
        </div>
      </section>

      {modalOpen && <LeadFormModal lead={lead} onClose={() => setModalOpen(false)} onSave={saveLead} />}
      {notesOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-sm">
          <div className="h-full w-full max-w-xl overflow-auto bg-white p-6 shadow-glow">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Private notes</h2>
                <p className="text-sm text-slate-500">{lead.company}</p>
              </div>
              <button onClick={() => setNotesOpen(false)} className="rounded-lg p-2 hover:bg-slate-100" aria-label="Close notes"><X size={18} /></button>
            </div>
            <form onSubmit={addNote} className="mb-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a private note..." />
              <Button className="mt-3"><Plus size={16} /> Add note</Button>
            </form>
            <div className="space-y-3">
              {lead.notes.map((item) => (
                <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  {editingNoteId === item.id ? (
                    <>
                      <Textarea value={editingNote} onChange={(event) => setEditingNote(event.target.value)} />
                      <div className="mt-3 flex gap-2">
                        <Button onClick={() => updateNote(item.id)}>Save</Button>
                        <Button variant="secondary" onClick={() => { setEditingNoteId(""); setEditingNote(""); }}>Cancel</Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="whitespace-pre-wrap text-sm text-slate-700">{item.note}</p>
                      <p className="mt-2 text-xs text-slate-400">{item.user.name} · {formatDate(item.createdAt)}</p>
                      <div className="mt-3 flex gap-2">
                        <Button variant="secondary" onClick={() => { setEditingNoteId(item.id); setEditingNote(item.note); }}><Pencil size={15} /> Edit</Button>
                        <Button variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={() => deleteNote(item.id)}><Trash2 size={15} /> Delete</Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {!lead.notes.length && <p className="rounded-2xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">No notes yet.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
