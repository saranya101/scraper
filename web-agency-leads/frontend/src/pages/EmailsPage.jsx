import { CheckCircle2, MailPlus, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge } from "../components/ui/Badge.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Input, Select, Textarea } from "../components/ui/Input.jsx";
import { useToast } from "../hooks/useToast.jsx";
import { api } from "../services/api.js";
import { domain, formatDate, priorities } from "../utils/format.js";

const initialFilters = {
  search: "",
  qualified: "false",
  minScore: "",
  maxScore: "",
  industryId: "",
  recommendedServiceId: "",
  priority: "",
  hasEmailOnly: "",
  contactState: "",
  missingBooking: "",
  missingAnalytics: "",
  withoutMetaPixel: ""
};

function money(value) {
  return value ? `$${Number(value).toLocaleString()}` : "-";
}

function messageWithoutSubject(message) {
  return String(message || "").replace(/^subject:\s?.*(\r?\n){1,2}/i, "").trim();
}

export default function EmailsPage() {
  const { push } = useToast();
  const [searchParams] = useSearchParams();
  const [catalog, setCatalog] = useState({ industries: [], services: [] });
  const [accounts, setAccounts] = useState([]);
  const [leads, setLeads] = useState([]);
  const [meta, setMeta] = useState({ total: 0 });
  const [filters, setFilters] = useState(initialFilters);
  const [selected, setSelected] = useState([]);
  const [approvalQueue, setApprovalQueue] = useState([]);
  const [approvalIndex, setApprovalIndex] = useState(0);
  const [preview, setPreview] = useState(null);
  const [testEmail, setTestEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);

  const selectedLeads = useMemo(() => leads.filter((lead) => selected.includes(lead.id)), [leads, selected]);
  const currentLead = approvalQueue[approvalIndex];
  const gmailSender = accounts.find((account) => account.provider === "GOOGLE");
  const gmailReady = Boolean(gmailSender?.configured && gmailSender?.active);

  async function loadLeads() {
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ""));
      const { data } = await api.get("/emails/leads", { params });
      setLeads(data.items || []);
      setMeta(data.meta || {});
    } catch (error) {
      push(error.response?.data?.message || "Could not load email leads", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api.get("/leads/meta/catalog").then(({ data }) => setCatalog(data)).catch(() => {});
    api.get("/email/accounts").then(({ data }) => setAccounts(data)).catch(() => {});
  }, []);

  useEffect(() => {
    const leadId = searchParams.get("leadId");
    if (!leadId) return;
    api.get(`/leads/${leadId}`).then(({ data }) => {
      const lead = {
        ...data,
        contactEmail: data.ownerEmail || data.generalEmail || "",
        recommendedService: data.serviceOpportunities?.find((item) => item.recommended)?.service || data.serviceOpportunities?.[0]?.service || null
      };
      setSelected([lead.id]);
      setApprovalQueue([lead]);
      setApprovalIndex(0);
      loadPreview(lead);
    }).catch((error) => push(error.response?.data?.message || "Could not open lead email preview", "error"));
  }, []);

  useEffect(() => {
    const timer = setTimeout(loadLeads, 200);
    return () => clearTimeout(timer);
  }, [JSON.stringify(filters)]);

  function toggleLead(id) {
    setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  }

  function selectVisible() {
    const ids = leads.map((lead) => lead.id);
    setSelected(selected.length === ids.length ? [] : ids);
  }

  async function generateSelected() {
    if (!selected.length) return push("Select leads first", "error");
    setProcessing(true);
    try {
      const { data } = await api.post("/emails/generate", { leadIds: selected });
      push(`Generated ${data.drafts?.length || 0} emails`);
      await loadLeads();
    } catch (error) {
      push(error.response?.data?.message || "Generation failed", "error");
    } finally {
      setProcessing(false);
    }
  }

  async function startApproval() {
    if (!selected.length) return push("Select leads first", "error");
    if (!gmailReady) return push("Connect ociastudios@gmail.com before sending", "error");
    const queue = selectedLeads.length ? selectedLeads : leads.filter((lead) => selected.includes(lead.id));
    setApprovalQueue(queue);
    setApprovalIndex(0);
    await loadPreview(queue[0]);
  }

  async function loadPreview(lead) {
    if (!lead) {
      setPreview(null);
      setApprovalQueue([]);
      setApprovalIndex(0);
      await loadLeads();
      return;
    }
    setProcessing(true);
    try {
      const { data } = await api.post("/emails/generate", { leadId: lead.id });
      const draft = data.drafts?.[0];
      setPreview({
        lead,
        draftId: draft?.id,
        toEmail: lead.contactEmail || "",
        subject: draft?.subject || `Quick idea for ${lead.company}`,
        body: messageWithoutSubject(draft?.fullMessage || ""),
        issue: draft?.opener || "No reliable evidence-backed observation available.",
        service: lead.recommendedService?.name || "Website redesign"
      });
    } catch (error) {
      push(error.response?.data?.message || "Could not generate preview", "error");
    } finally {
      setProcessing(false);
    }
  }

  async function nextPreview() {
    const nextIndex = approvalIndex + 1;
    setApprovalIndex(nextIndex);
    await loadPreview(approvalQueue[nextIndex]);
  }

  async function sendPreview() {
    if (!preview?.toEmail) return push("Recipient email missing", "error");
    setProcessing(true);
    try {
      const { data } = await api.post("/emails/send-one", {
        leadId: preview.lead.id,
        outreachDraftId: preview.draftId,
        toEmail: preview.toEmail,
        subject: preview.subject,
        body: preview.body
      });
      if (data.status === "SENT") push(`Sent to ${preview.lead.company}`);
      else push(data.errorMessage || "Send failed", "error");
      await nextPreview();
    } catch (error) {
      push(error.response?.data?.message || "Send failed", "error");
    } finally {
      setProcessing(false);
    }
  }

  async function sendTestEmail() {
    if (!preview?.lead) return;
    if (!testEmail) return push("Add a test email first", "error");
    if (!gmailReady) return push("Connect ociastudios@gmail.com before sending", "error");
    setProcessing(true);
    try {
      const { data } = await api.post("/emails/send-test", {
        leadId: preview.lead.id,
        outreachDraftId: preview.draftId,
        testEmail,
        subject: preview.subject,
        body: preview.body
      });
      if (data.status === "SENT") push(`Test email sent to ${testEmail}`);
      else push(data.errorMessage || "Test email failed", "error");
    } catch (error) {
      push(error.response?.data?.message || "Test email failed", "error");
    } finally {
      setProcessing(false);
    }
  }

  async function saveDraft() {
    if (!preview?.draftId) return;
    await api.put(`/outreach/${preview.draftId}`, { subject: preview.subject, fullMessage: preview.body, status: "SAVED" });
    push("Draft saved");
  }

  async function markContacted() {
    if (!selected.length) return push("Select leads first", "error");
    await api.put("/leads/bulk", { leadIds: selected, pipelineStage: "SENT" });
    push("Marked selected leads as contacted");
    setSelected([]);
    await loadLeads();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">Qualified outreach</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Emails</h1>
        <p className="mt-2 max-w-2xl text-slate-500">Search leads, generate emails, preview and edit each message, then send manually.</p>
        </div>
        <Link to="/settings/email" className="inline-flex items-center justify-center rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50">
          {gmailReady ? `Sending from ${gmailSender.email}` : "Connect Gmail"}
        </Link>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-6">
          <Input className="md:col-span-2" placeholder="Search company, website, email..." value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
          <Select value={filters.qualified} onChange={(e) => setFilters({ ...filters, qualified: e.target.value })}>
            <option value="false">All leads</option>
            <option value="true">Qualified only</option>
          </Select>
          <Input placeholder="Min score" value={filters.minScore} onChange={(e) => setFilters({ ...filters, minScore: e.target.value })} />
          <Input placeholder="Max score" value={filters.maxScore} onChange={(e) => setFilters({ ...filters, maxScore: e.target.value })} />
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
          <Select value={filters.contactState} onChange={(e) => setFilters({ ...filters, contactState: e.target.value })}>
            <option value="">Any contact state</option>
            <option value="not_contacted">Not contacted</option>
            <option value="contacted">Already contacted</option>
          </Select>
          <Select value={filters.hasEmailOnly} onChange={(e) => setFilters({ ...filters, hasEmailOnly: e.target.value })}>
            <option value="">With or without email</option>
            <option value="true">Has email only</option>
          </Select>
          <Select value={filters.missingBooking} onChange={(e) => setFilters({ ...filters, missingBooking: e.target.value })}>
            <option value="">Any booking state</option>
            <option value="true">Missing booking</option>
          </Select>
          <Select value={filters.missingAnalytics} onChange={(e) => setFilters({ ...filters, missingAnalytics: e.target.value })}>
            <option value="">Any analytics state</option>
            <option value="true">Missing analytics</option>
          </Select>
          <Select value={filters.withoutMetaPixel} onChange={(e) => setFilters({ ...filters, withoutMetaPixel: e.target.value })}>
            <option value="">Any Meta Pixel state</option>
            <option value="true">Without Meta Pixel</option>
          </Select>
        </div>
      </div>

      {selected.length > 0 && (
        <div className="sticky top-20 z-10 flex flex-col gap-3 rounded-3xl border border-slate-200 bg-slate-950 p-4 text-white shadow-glow md:flex-row md:items-center md:justify-between">
          <p className="font-semibold">{selected.length} leads selected</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={generateSelected} disabled={processing}><MailPlus size={16} /> Generate emails</Button>
            <Button variant="secondary" onClick={startApproval} disabled={processing}><CheckCircle2 size={16} /> Generate + send with approval</Button>
            <Button variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={markContacted}>Mark as contacted</Button>
          </div>
        </div>
      )}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <div>
            <h2 className="font-semibold">Qualified leads</h2>
            <p className="text-sm text-slate-500">{meta.total || 0} matching leads</p>
          </div>
          <Button variant="secondary" onClick={loadLeads} disabled={loading}><RefreshCw size={16} /> Refresh</Button>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3"><input type="checkbox" checked={leads.length > 0 && selected.length === leads.length} onChange={selectVisible} /></th>
                {["Company", "Industry", "Website", "Score", "Value", "Service", "Contact email", "Email status", "Last contacted", "Actions"].map((header) => <th key={header} className="px-4 py-3">{header}</th>)}
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="border-t border-slate-100">
                  <td className="px-4 py-3"><input type="checkbox" checked={selected.includes(lead.id)} onChange={() => toggleLead(lead.id)} /></td>
                  <td className="px-4 py-3 font-semibold"><Link to={`/leads/${lead.id}`} className="hover:underline">{lead.company}</Link></td>
                  <td className="px-4 py-3">{lead.industryRef?.name || lead.industry || "-"}</td>
                  <td className="px-4 py-3">{domain(lead.website)}</td>
                  <td className="px-4 py-3"><Badge className={priorities[lead.priority]?.className}>{lead.score}/10</Badge></td>
                  <td className="px-4 py-3">{money(lead.estimatedValue)}</td>
                  <td className="px-4 py-3">{lead.recommendedService?.name || "-"}</td>
                  <td className="px-4 py-3">{lead.contactEmail || <span className="text-rose-500">Missing</span>}</td>
                  <td className="px-4 py-3">{lead.emailStatus || "NOT_SENT"}</td>
                  <td className="px-4 py-3">{lead.lastContactedAt ? formatDate(lead.lastContactedAt) : "-"}</td>
                  <td className="px-4 py-3"><Button variant="secondary" onClick={() => { setSelected([lead.id]); setApprovalQueue([lead]); setApprovalIndex(0); loadPreview(lead); }}>Preview</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!leads.length && <p className="p-8 text-center text-sm text-slate-500">No qualified email leads match these filters.</p>}
        </div>
      </section>

      {preview && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-3xl bg-white p-6 shadow-glow">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">Manual approval</p>
                <h2 className="mt-1 text-2xl font-semibold">{preview.lead.company}</h2>
                <p className="mt-1 text-sm text-slate-500">Lead {approvalIndex + 1} of {approvalQueue.length || 1}</p>
              </div>
              <button onClick={() => setPreview(null)} className="rounded-lg p-2 hover:bg-slate-100"><X size={18} /></button>
            </div>
            <div className="mb-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Evidence-backed context</p>
                <p className="mt-1 text-sm">{preview.issue}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recommended service</p>
                <p className="mt-1 text-sm font-semibold">{preview.service}</p>
              </div>
            </div>
            <div className="grid gap-4">
              <label><span className="mb-1.5 block text-sm font-medium">Recipient email</span><Input value={preview.toEmail} onChange={(e) => setPreview({ ...preview, toEmail: e.target.value })} /></label>
              <label><span className="mb-1.5 block text-sm font-medium">Subject</span><Input value={preview.subject} onChange={(e) => setPreview({ ...preview, subject: e.target.value })} /></label>
              <label><span className="mb-1.5 block text-sm font-medium">Email body</span><Textarea className="min-h-72" value={preview.body} onChange={(e) => setPreview({ ...preview, body: e.target.value })} /></label>
              <label>
                <span className="mb-1.5 block text-sm font-medium">Test email before sending to lead</span>
                <div className="flex gap-2">
                  <Input value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="you@youragency.com" />
                  <Button type="button" variant="secondary" onClick={sendTestEmail} disabled={processing || !gmailReady}>Send test</Button>
                </div>
              </label>
            </div>
            <div className="mt-5 flex flex-wrap justify-between gap-3">
              <Button variant="secondary" onClick={saveDraft}>Save draft</Button>
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" onClick={nextPreview}>Skip</Button>
                <Button variant="secondary" onClick={nextPreview}>Next</Button>
                <Button onClick={sendPreview} disabled={processing || !gmailReady}>{processing ? "Sending..." : "Send"}</Button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
