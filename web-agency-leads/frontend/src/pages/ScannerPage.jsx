import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, CopyPlus, History, Play, RefreshCw, Save, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "../components/ui/Badge.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Input, Select } from "../components/ui/Input.jsx";
import { useToast } from "../hooks/useToast.jsx";
import { api } from "../services/api.js";
import { domain, formatDate, priorities, websiteStatuses } from "../utils/format.js";
import { workspaceLabel } from "../utils/workspaces.js";

const initialForm = {
  keyword: "aesthetic clinic",
  services: "",
  country: "Singapore",
  state: "",
  city: "",
  location: "",
  maxResults: 10,
  scanDepth: "QUICK",
  minReviews: "",
  hasWebsiteOnly: true,
  includeKeywords: "",
  excludeKeywords: "",
  minimumScore: "",
  priority: "",
  websiteStatus: ""
};

export default function ScannerPage() {
  const { push } = useToast();
  const [searchParams] = useSearchParams();
  const industrySlug = searchParams.get("industry") || "";
  const industryName = searchParams.get("name") || workspaceLabel(industrySlug, "");
  const templateId = searchParams.get("templateId") || "";
  const [form, setForm] = useState(() => ({
    ...initialForm,
    ...(industryName ? { keyword: industryName } : {}),
    industrySlug
  }));
  const [history, setHistory] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState([]);
  const [running, setRunning] = useState(false);
  const [filters, setFilters] = useState({ priority: "", websiteStatus: "", accessIssue: "", duplicate: "", imported: "", hasScreenshot: "", failed: "" });

  const activeScanId = activeJob?.id || history[0]?.id;
  const failedResults = results.filter((result) => result.accessIssue || result.websiteStatus !== "WORKING" || String(result.issues || "").includes("failed"));

  async function loadHistory() {
    const { data } = await api.get("/scanner/history");
    setHistory(data);
    if (!activeJob && data[0]) setActiveJob(data[0]);
  }

  async function loadTemplates() {
    const { data } = await api.get("/scanner/templates", { params: industrySlug ? { industrySlug } : {} });
    setTemplates(data);
  }

  async function loadResults(scanId = activeScanId) {
    if (!scanId) return;
    const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
    const { data } = await api.get(`/scanner/results/${scanId}`, { params });
    setResults(data);
  }

  useEffect(() => {
    loadHistory().catch(() => {});
    loadTemplates().catch(() => {});
  }, [industrySlug]);

  useEffect(() => {
    if (templateId) return;
    setForm((current) => ({
      ...current,
      ...(industryName ? { keyword: industryName } : {}),
      industrySlug
    }));
  }, [industrySlug, industryName, templateId]);

  useEffect(() => {
    if (!templateId || !templates.length) return;
    const template = templates.find((item) => item.id === templateId);
    if (template) setForm({ ...initialForm, ...form, ...template, ...(template.filters || {}), industrySlug });
  }, [templateId, templates.length]);

  useEffect(() => {
    loadResults().catch(() => {});
  }, [activeScanId, JSON.stringify(filters)]);

  useEffect(() => {
    if (!activeJob || !["QUEUED", "RUNNING", "PENDING"].includes(activeJob.status)) return;
    const timer = setInterval(async () => {
      const { data } = await api.get("/scanner/history");
      setHistory(data);
      const refreshed = data.find((job) => job.id === activeJob.id);
      if (refreshed) setActiveJob(refreshed);
      await loadResults(activeJob.id);
      if (refreshed && !["QUEUED", "RUNNING", "PENDING"].includes(refreshed.status)) setRunning(false);
    }, 2500);
    return () => clearInterval(timer);
  }, [activeJob?.id, activeJob?.status]);

  async function runScan(event) {
    event.preventDefault();
    setRunning(true);
    setSelected([]);
    try {
      const { data } = await api.post("/scanner/run", {
        keyword: form.keyword,
        services: form.services,
        location: form.location,
        country: form.country,
        state: form.state,
        city: form.city,
        maxResults: Number(form.maxResults),
        scanDepth: form.scanDepth,
        minReviews: form.minReviews === "" ? undefined : Number(form.minReviews),
        hasWebsiteOnly: form.hasWebsiteOnly,
        filters: {
          industrySlug,
          includeKeywords: form.includeKeywords,
          excludeKeywords: form.excludeKeywords,
          minimumScore: form.minimumScore ? Number(form.minimumScore) : undefined,
          priority: form.priority,
          websiteStatus: form.websiteStatus
        }
      });
      setActiveJob(data);
      push("Scan started");
      await loadHistory();
      await loadResults(data.id);
    } catch (error) {
      push(error.response?.data?.message || "Scan failed", "error");
    } finally {
      setRunning(false);
    }
  }

  async function saveTemplate() {
    const templateLocation = [form.city, form.state, form.country].filter(Boolean).join(", ") || form.location;
    await api.post("/scanner/templates", {
      name: `${form.keyword} · ${templateLocation}`,
      keyword: form.keyword,
      location: form.location,
      country: form.country,
      state: form.state,
      city: form.city,
      maxResults: Number(form.maxResults),
      filters: form
        ? { ...form, industrySlug }
        : { industrySlug }
    });
    push("Template saved");
    loadTemplates();
  }

  async function rerun(scanId) {
    setRunning(true);
    try {
      const { data } = await api.post(`/scanner/rerun/${scanId}`);
      setActiveJob(data);
      push("Scan rerun started");
      loadHistory();
      loadResults(data.id);
    } catch (error) {
      push(error.response?.data?.message || "Rerun failed", "error");
    } finally {
      setRunning(false);
    }
  }

  async function importSelected() {
    if (!selected.length) return push("Select scan results first", "error");
    const { data } = await api.post("/scanner/import", { scanResultIds: selected });
    push(`Imported ${data.imported}, skipped ${data.skipped}`);
    setSelected([]);
    loadResults();
  }

  async function retryResult(id) {
    try {
      await api.post(`/scanner/retry/${id}`);
      push("Retry queued");
      await loadHistory();
    } catch (error) {
      push(error.response?.data?.message || "Retry failed", "error");
    }
  }

  function toggle(id) {
    setSelected((items) => (items.includes(id) ? items.filter((item) => item !== id) : [...items, id]));
  }

  const logs = useMemo(() => (Array.isArray(activeJob?.logs) ? activeJob.logs : []), [activeJob]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">Lead intelligence</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Scanner dashboard</h1>
          <p className="mt-2 max-w-2xl text-slate-500">
            {industrySlug ? `Running inside the ${industryName} workspace. Results will keep this industry assignment.` : "Google Places discovery, Playwright screenshots, OpenAI audits, and filtered imports into your lead pipeline."}
          </p>
        </div>
        <Button onClick={importSelected} disabled={!selected.length}><CopyPlus size={16} /> Import selected ({selected.length})</Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <motion.form initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} onSubmit={runScan} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Run scan</h2>
              <p className="text-sm text-slate-500">Uses real Google Places, browser screenshots, and OpenAI audits.</p>
            </div>
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-white"><Sparkles size={20} /></div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label><span className="mb-1.5 block text-sm font-medium">Industry / keyword</span><Input value={form.keyword} onChange={(e) => setForm({ ...form, keyword: e.target.value })} required /></label>
            <label><span className="mb-1.5 block text-sm font-medium">Services</span><Input value={form.services} onChange={(e) => setForm({ ...form, services: e.target.value })} placeholder="SEO, booking, redesign" /></label>
            <label><span className="mb-1.5 block text-sm font-medium">Country</span><Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></label>
            <label><span className="mb-1.5 block text-sm font-medium">State</span><Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="Optional" /></label>
            <label><span className="mb-1.5 block text-sm font-medium">City</span><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Optional" /></label>
            <label><span className="mb-1.5 block text-sm font-medium">Fallback location</span><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Used if city/country are blank" /></label>
            <label><span className="mb-1.5 block text-sm font-medium">Max results</span><Input type="number" min="1" max="100" value={form.maxResults} onChange={(e) => setForm({ ...form, maxResults: e.target.value })} /></label>
            <label><span className="mb-1.5 block text-sm font-medium">Scan depth</span><Select value={form.scanDepth} onChange={(e) => setForm({ ...form, scanDepth: e.target.value })}><option value="QUICK">Quick</option><option value="FULL">Full</option><option value="DEEP">Deep</option></Select></label>
            <label><span className="mb-1.5 block text-sm font-medium">Min Google reviews</span><Input type="number" min="0" value={form.minReviews} onChange={(e) => setForm({ ...form, minReviews: e.target.value })} placeholder="0" /></label>
            <label><span className="mb-1.5 block text-sm font-medium">Minimum score</span><Input type="number" min="1" max="10" value={form.minimumScore} onChange={(e) => setForm({ ...form, minimumScore: e.target.value })} placeholder="Optional" /></label>
            <label><span className="mb-1.5 block text-sm font-medium">Include keywords</span><Input value={form.includeKeywords} onChange={(e) => setForm({ ...form, includeKeywords: e.target.value })} placeholder="Comma separated" /></label>
            <label><span className="mb-1.5 block text-sm font-medium">Exclude keywords</span><Input value={form.excludeKeywords} onChange={(e) => setForm({ ...form, excludeKeywords: e.target.value })} placeholder="Comma separated" /></label>
            <label><span className="mb-1.5 block text-sm font-medium">Priority filter</span><Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="">Any</option><option value="HOT">HOT</option><option value="WARM">WARM</option><option value="COLD">COLD</option></Select></label>
            <label><span className="mb-1.5 block text-sm font-medium">Website status</span><Select value={form.websiteStatus} onChange={(e) => setForm({ ...form, websiteStatus: e.target.value })}><option value="">Any</option>{Object.entries(websiteStatuses).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</Select></label>
            <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium">
              <input type="checkbox" checked={form.hasWebsiteOnly} onChange={(e) => setForm({ ...form, hasWebsiteOnly: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
              Has website only
            </label>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button disabled={running}><Play size={16} /> {running ? "Running scan..." : "Run Scan"}</Button>
            <Button type="button" variant="secondary" onClick={saveTemplate}><Save size={16} /> Save template</Button>
          </div>
        </motion.form>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Live progress</h2>
            {activeJob && <Badge className="bg-slate-100 text-slate-700 ring-slate-200">{activeJob.status}</Badge>}
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-slate-950 transition-all" style={{ width: `${activeJob?.progress || 0}%` }} />
          </div>
          <p className="mt-2 text-sm text-slate-500">{activeJob?.progress || 0}% complete · {activeJob?._count?.results || 0} saved results</p>
          <div className="mt-5 max-h-72 space-y-2 overflow-auto rounded-2xl bg-slate-950 p-4 text-sm text-slate-200">
            {logs.length ? logs.map((log, index) => <p key={index}><span className="text-slate-500">{formatDate(log.at)}</span> {log.message}</p>) : <p className="text-slate-500">No scan logs yet.</p>}
          </div>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.7fr_1.3fr]">
        <section className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><History size={18} /> Scan history</h2>
            <div className="space-y-2">
              {history.map((job) => (
                <div key={job.id} className={`rounded-2xl border p-4 transition ${activeJob?.id === job.id ? "border-slate-950 bg-slate-50" : "border-slate-200 hover:bg-slate-50"}`}>
                  <button type="button" onClick={() => setActiveJob(job)} className="block w-full text-left">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold">{job.keyword}</p>
                      <Badge className="bg-slate-100 text-slate-700 ring-slate-200">{job.status}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{job.location} · {job._count?.results || 0} results</p>
                  </button>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-slate-400">{formatDate(job.createdAt)}</span>
                    <Button type="button" variant="ghost" className="px-2" onClick={() => rerun(job.id)}><RefreshCw size={14} /></Button>
                  </div>
                </div>
              ))}
              {!history.length && <p className="text-sm text-slate-500">No scans yet.</p>}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Saved templates</h2>
            <div className="space-y-2">
              {templates.map((template) => (
                <button key={template.id} onClick={() => setForm({ ...form, ...template, ...(template.filters || {}) })} className="w-full rounded-2xl border border-slate-200 p-4 text-left hover:bg-slate-50">
                  <p className="font-semibold">{template.name}</p>
                  <p className="text-sm text-slate-500">{template.keyword} · {template.location}</p>
                </button>
              ))}
              {!templates.length && <p className="text-sm text-slate-500">No templates saved.</p>}
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="grid gap-3 md:grid-cols-6">
              <div className="relative md:col-span-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <Input className="pl-9" placeholder="Results are filtered by controls" disabled />
              </div>
              <Select value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}><option value="">All priorities</option><option value="HOT">HOT</option><option value="WARM">WARM</option><option value="COLD">COLD</option></Select>
              <Select value={filters.websiteStatus} onChange={(e) => setFilters({ ...filters, websiteStatus: e.target.value })}><option value="">All statuses</option>{Object.entries(websiteStatuses).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</Select>
              <Input value={filters.accessIssue} onChange={(e) => setFilters({ ...filters, accessIssue: e.target.value })} placeholder="Issue type" />
              <Select value={filters.duplicate} onChange={(e) => setFilters({ ...filters, duplicate: e.target.value })}><option value="">Unique + duplicates</option><option value="false">Unique only</option><option value="true">Duplicates only</option></Select>
              <Select value={filters.failed} onChange={(e) => setFilters({ ...filters, failed: e.target.value })}><option value="">All outcomes</option><option value="true">Failed/blocked only</option></Select>
            </div>
          </div>
          <div className="space-y-3">
            {failedResults.length > 0 && (
              <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
                <h3 className="mb-3 flex items-center gap-2 font-semibold text-amber-900"><AlertTriangle size={17} /> Failed or blocked results</h3>
                <div className="space-y-2">
                  {failedResults.slice(0, 6).map((result) => (
                    <div key={result.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white p-3 text-sm">
                      <div>
                        <p className="font-semibold text-slate-900">{result.company}</p>
                        <p className="text-slate-500">{websiteStatuses[result.websiteStatus]?.label || result.websiteStatus} · {result.accessIssueReason || "Needs review"}</p>
                      </div>
                      <Button variant="secondary" onClick={() => retryResult(result.id)}><RefreshCw size={14} /> Retry</Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {results.map((result) => (
              <article key={result.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="flex gap-3">
                    <input type="checkbox" checked={selected.includes(result.id)} onChange={() => toggle(result.id)} className="mt-1 h-4 w-4 rounded border-slate-300" />
                    <div>
                      <h3 className="font-semibold">{result.company}</h3>
                      <p className="text-sm text-slate-500">{result.website ? domain(result.website) : "No website"} · {result.location}</p>
                      <p className="mt-2 text-sm text-slate-600">{(Array.isArray(result.issues) ? result.issues : []).slice(0, 2).join(" · ") || "No issues returned yet."}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    <Badge className={priorities[result.priority]?.className}>{priorities[result.priority]?.label}</Badge>
                    <Badge className={websiteStatuses[result.websiteStatus]?.className}>{websiteStatuses[result.websiteStatus]?.label}</Badge>
                    {result.duplicate && <Badge className="bg-zinc-100 text-zinc-700 ring-zinc-200">Duplicate</Badge>}
                    {result.imported && <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200"><CheckCircle2 size={12} /> Imported</Badge>}
                  </div>
                </div>
                {(result.screenshotPath || result.mobileScreenshotPath) && (
                  <div className="mt-4 grid gap-3 md:grid-cols-[1fr_160px]">
                    {result.screenshotPath && <img src={result.screenshotPath} alt={`${result.company} desktop screenshot`} className="h-40 w-full rounded-2xl border border-slate-200 object-cover" />}
                    {result.mobileScreenshotPath && <img src={result.mobileScreenshotPath} alt={`${result.company} mobile screenshot`} className="h-40 w-full rounded-2xl border border-slate-200 object-cover" />}
                  </div>
                )}
                <div className="mt-4 grid gap-3 md:grid-cols-[120px_120px_1fr]">
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Score</p><p className="text-2xl font-semibold">{result.score}/10</p></div>
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-400">Opportunity</p><p className="text-2xl font-semibold">{result.opportunityScore || "-"}/10</p></div>
                  <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{result.outreachEmail || result.accessIssueReason || "Ready for review."}</p>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-slate-500 md:grid-cols-4">
                  <span>Load: {result.loadTime ? `${result.loadTime}ms` : "-"}</span>
                  <span>SSL: {result.sslValid == null ? "-" : result.sslValid ? "valid" : "issue"}</span>
                  <span>Redirects: {result.redirectCount ?? "-"}</span>
                  <span>Contact: {result.contactPageUrl ? "found" : "-"}</span>
                </div>
              </article>
            ))}
            {!results.length && <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500">Run a scan or select a scan from history to preview results.</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
