import { ArrowLeft, ArrowUpRight, Clipboard, GitCompare, Mail, MailPlus, MapPin, Pencil, Phone, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import LeadFormModal from "../components/LeadFormModal.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Select, Textarea } from "../components/ui/Input.jsx";
import { useToast } from "../hooks/useToast.jsx";
import { api } from "../services/api.js";
import { domain, formatDate, pipelineStages, priorities, statuses, websiteStatuses } from "../utils/format.js";

export default function LeadDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { push } = useToast();
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [drafts, setDrafts] = useState([]);
  const [competitorData, setCompetitorData] = useState({ competitors: [], salesAngle: "", leadScore: null });
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [competitorLoading, setCompetitorLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  async function loadLead() {
    setLoading(true);
    try {
      const { data } = await api.get(`/leads/${id}`);
      setLead(data);
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

  useEffect(() => {
    loadLead();
  }, [id]);

  useEffect(() => {
    loadDrafts().catch(() => {});
    loadCompetitors().catch(() => {});
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

  async function addNote(event) {
    event.preventDefault();
    if (!note.trim()) return;
    await api.post("/notes", { leadId: id, note });
    setNote("");
    push("Note added");
    loadLead();
  }

  async function copyOutreach() {
    await navigator.clipboard.writeText(lead.outreachEmail || "");
    push("Outreach copied");
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

  if (loading || !lead) return <div className="rounded-3xl border border-slate-200 bg-white p-10 text-slate-500">Loading lead...</div>;

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
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setModalOpen(true)}><Pencil size={16} /> Edit</Button>
          <Button variant="danger" onClick={removeLead}><Trash2 size={16} /> Delete</Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="space-y-6">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="aspect-[16/9] bg-[linear-gradient(135deg,#f8fafc,#e2e8f0)]">
              {lead.screenshotPath ? (
                <img src={lead.screenshotPath} alt={`${lead.company} website screenshot`} className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full place-items-center p-8 text-center">
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
              <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                {[
                  ["Visual", lead.visualDesignScore],
                  ["Mobile", lead.mobileScore],
                  ["Trust", lead.trustScore],
                  ["CTA", lead.ctaScore],
                  ["SEO", lead.seoScore],
                  ["Opportunity", lead.opportunityScore]
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl bg-slate-50 p-3">
                    <p className="text-xs text-slate-400">{label}</p>
                    <p className="mt-1 text-2xl font-semibold">{value || "-"}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
              <p className="mb-2 text-sm font-semibold">Mobile screenshot</p>
              <div className="aspect-[9/16] overflow-hidden rounded-2xl bg-slate-100">
                {lead.mobileScreenshotPath ? <img src={lead.mobileScreenshotPath} alt={`${lead.company} mobile screenshot`} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center px-4 text-center text-sm text-slate-400">No mobile screenshot</div>}
              </div>
            </div>
          </div>

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
            <h2 className="mb-4 text-lg font-semibold">Recommended fixes</h2>
            {Array.isArray(lead.recommendedFixes) && lead.recommendedFixes.length ? (
              <ul className="space-y-3">
                {lead.recommendedFixes.map((fix, index) => <li key={index} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">{fix}</li>)}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No recommended fixes saved yet.</p>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Service opportunities</h2>
                <p className="text-sm text-slate-500">What we should sell, estimated value, and why.</p>
              </div>
              <Button variant="secondary" onClick={reprocessOpportunities}>Reprocess</Button>
            </div>
            {lead.serviceOpportunities?.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {lead.serviceOpportunities.map((opportunity) => (
                  <div key={opportunity.id} className={`rounded-2xl border p-4 ${opportunity.recommended ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-950">{opportunity.service.name}</p>
                        {opportunity.recommended && <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">Recommended primary service</p>}
                      </div>
                      <Badge className={opportunity.score >= 8 ? "bg-emerald-100 text-emerald-800 ring-emerald-200" : opportunity.score >= 6 ? "bg-amber-100 text-amber-800 ring-amber-200" : "bg-slate-100 text-slate-700 ring-slate-200"}>{opportunity.score}/10</Badge>
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
              <p className="mt-3 text-sm leading-6">{competitorData.salesAngle || "Run competitor discovery to generate a comparison-based pitch."}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold">{lead.company}</p>
                <p className="mt-2 text-3xl font-semibold">{lead.score}<span className="text-base text-slate-400">/10</span></p>
                <p className="mt-1 text-xs text-slate-500">Lead website score</p>
              </div>
              {competitorData.competitors.map((competitor) => (
                <div key={competitor.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="aspect-[16/10] bg-slate-100">
                    {competitor.screenshotPath ? (
                      <img src={competitor.screenshotPath} alt={`${competitor.company} website screenshot`} className="h-full w-full object-cover" />
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
              <h2 className="text-lg font-semibold">Outreach email</h2>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={generateOutreach} disabled={generatingDraft}><MailPlus size={16} /> {generatingDraft ? "Generating..." : "Generate"}</Button>
                <Button variant="secondary" onClick={copyOutreach} disabled={!lead.outreachEmail}><Clipboard size={16} /> Copy</Button>
              </div>
            </div>
            <pre className="whitespace-pre-wrap rounded-2xl bg-slate-950 p-5 text-sm leading-6 text-slate-100">{lead.outreachEmail || "No outreach copy saved yet."}</pre>
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

        <aside className="space-y-6">
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
            <div className="space-y-3">
              {lead.notes.map((item) => (
                <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm text-slate-700">{item.note}</p>
                  <p className="mt-2 text-xs text-slate-400">{item.user.name} · {formatDate(item.createdAt)}</p>
                </div>
              ))}
              {!lead.notes.length && <p className="text-sm text-slate-500">No notes yet.</p>}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">History timeline</h2>
            <div className="space-y-4">
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
          </div>
        </aside>
      </div>

      {modalOpen && <LeadFormModal lead={lead} onClose={() => setModalOpen(false)} onSave={saveLead} />}
    </div>
  );
}
