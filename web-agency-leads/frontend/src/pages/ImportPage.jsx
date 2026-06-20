import { FileSpreadsheet, RefreshCw, UploadCloud, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/Button.jsx";
import { Select } from "../components/ui/Input.jsx";
import { useToast } from "../hooks/useToast.jsx";
import { api } from "../services/api.js";
import { formatDate } from "../utils/format.js";

const fieldLabels = {
  company: "Company",
  website: "Website",
  phone: "Phone",
  address: "Address",
  industry: "Industry",
  location: "Location",
  score: "Score",
  visualDesignScore: "Visual score",
  mobileScore: "Mobile score",
  trustScore: "Trust score",
  ctaScore: "CTA score",
  seoScore: "SEO score",
  opportunityScore: "Opportunity score",
  screenshotPath: "Desktop screenshot",
  mobileScreenshotPath: "Mobile screenshot",
  outreachEmail: "Outreach email",
  issues: "Issues",
  recommendedFixes: "Recommended fixes",
  websiteStatus: "Website status",
  estimatedProjectValue: "Estimated value"
};

export default function ImportPage() {
  const { push } = useToast();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [history, setHistory] = useState([]);
  const [duplicateMode, setDuplicateMode] = useState("skip");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const cancelRequested = useRef(false);

  async function loadHistory() {
    const { data } = await api.get("/imports/history");
    setHistory(data);
  }

  useEffect(() => {
    loadHistory().catch(() => {});
  }, []);

  async function previewImport(event) {
    event.preventDefault();
    if (!file) return push("Choose a CSV or XLSX file first", "error");
    setLoading(true);
    setResult(null);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const { data } = await api.post("/imports/preview", formData, { headers: { "Content-Type": "multipart/form-data" } });
      setPreview(data);
      push("Preview ready");
    } catch (error) {
      push(error.response?.data?.message || "Preview failed", "error");
    } finally {
      setLoading(false);
    }
  }

  async function updateMapping(field, column) {
    const mapping = { ...preview.mapping, [field]: column || undefined };
    const { data } = await api.put(`/imports/preview/${preview.sessionId}`, { mapping });
    setPreview(data);
  }

  async function commitImport() {
    setLoading(true);
    setImporting(true);
    cancelRequested.current = false;
    try {
      const { data } = await api.post(`/imports/commit/${preview.sessionId}`, { duplicateMode });
      setResult(data);
      setPreview(null);
      setFile(null);
      push(data.cancelled || cancelRequested.current ? "Import cancelled" : "Import complete");
      await loadHistory();
    } catch (error) {
      push(error.response?.data?.message || "Import failed", "error");
    } finally {
      setImporting(false);
      setLoading(false);
    }
  }

  async function cancelImport() {
    if (!preview) return;
    cancelRequested.current = true;
    await api.post(`/imports/cancel/${preview.sessionId}`).catch(() => {});
    setPreview(null);
    setResult(null);
    push(importing ? "Cancellation requested" : "Import cancelled");
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">Bulk intake</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Import leads</h1>
        <p className="mt-2 max-w-2xl text-slate-500">Preview, map columns, choose duplicate handling, then import. Nothing is written until you confirm.</p>
      </div>

      <form onSubmit={previewImport} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <label className="grid min-h-64 cursor-pointer place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center transition hover:border-slate-400 hover:bg-white">
          <input type="file" accept=".csv,.xlsx" className="sr-only" onChange={(event) => setFile(event.target.files?.[0] || null)} />
          <div>
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-slate-950 text-white">
              {file ? <FileSpreadsheet size={24} /> : <UploadCloud size={24} />}
            </div>
            <h3 className="text-lg font-semibold">{file ? file.name : "Drop in a CSV/XLSX export"}</h3>
            <p className="mt-2 text-sm text-slate-500">Column aliases like Company Name, Business URL, Site, and Industry Type are mapped automatically.</p>
          </div>
        </label>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          {preview && <Button type="button" variant="secondary" onClick={cancelImport}><XCircle size={16} /> Cancel import</Button>}
          <Button disabled={loading}>{loading ? "Working..." : "Preview import"}</Button>
        </div>
      </form>

      {preview && (
        <section className="space-y-6">
          <div className="grid gap-3 md:grid-cols-5">
            {[
              ["Rows found", preview.rowsFound],
              ["Valid rows", preview.validRows],
              ["Duplicates", preview.duplicates],
              ["Missing website", preview.missingWebsite],
              ["Ready", preview.readyToImport]
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm text-slate-500">{label}</p>
                <p className="mt-2 text-3xl font-semibold">{value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Column mapping</h2>
                <p className="text-sm text-slate-500">Adjust any detected mapping before import.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Duplicates</span>
                <Select value={duplicateMode} onChange={(e) => setDuplicateMode(e.target.value)} className="w-44">
                  <option value="skip">Skip</option>
                  <option value="update">Update existing</option>
                  <option value="merge">Merge missing fields</option>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {(preview.fields || []).map((field) => (
                <label key={field}>
                  <span className="mb-1.5 block text-sm font-medium">{fieldLabels[field] || field}</span>
                  <Select value={preview.mapping?.[field] || ""} onChange={(e) => updateMapping(field, e.target.value)}>
                    <option value="">Not mapped</option>
                    {preview.headers.map((header) => <option key={header} value={header}>{header}</option>)}
                  </Select>
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={cancelImport}><XCircle size={16} /> {importing ? "Cancel import" : "Cancel"}</Button>
              <Button onClick={commitImport} disabled={loading || !preview.readyToImport}><RefreshCw size={16} /> {importing ? "Importing..." : "Import ready rows"}</Button>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Preview table</h2>
            <div className="overflow-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    {["Company", "Website", "Industry", "Score", "Duplicate", "Missing website"].map((header) => <th key={header} className="border-b border-slate-200 px-3 py-2">{header}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.map((row) => (
                    <tr key={row.index} className="border-b border-slate-100">
                      <td className="px-3 py-3 font-semibold">{row.company || "-"}</td>
                      <td className="px-3 py-3">{row.website || "-"}</td>
                      <td className="px-3 py-3">{row.industry || "-"}</td>
                      <td className="px-3 py-3">{row.score || "-"}</td>
                      <td className="px-3 py-3">{row.duplicate ? "Yes" : "No"}</td>
                      <td className="px-3 py-3">{row.missingWebsite ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {result && (
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">Rows scanned</p><p className="mt-2 text-3xl font-semibold">{result.totalRows}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">Imported</p><p className="mt-2 text-3xl font-semibold text-emerald-600">{result.imported}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">Duplicates</p><p className="mt-2 text-3xl font-semibold text-amber-600">{result.duplicates}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">Failed</p><p className="mt-2 text-3xl font-semibold text-rose-600">{result.failed}</p></div>
        </div>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Import history</h2>
        <div className="overflow-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                {["File", "Imported by", "Rows found", "Imported", "Duplicates", "Failed", "Created"].map((header) => <th key={header} className="border-b border-slate-200 px-3 py-2">{header}</th>)}
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr key={item.id} className="border-b border-slate-100">
                  <td className="px-3 py-3 font-semibold">{item.fileName}</td>
                  <td className="px-3 py-3">{item.user?.name || item.user?.email || "-"}</td>
                  <td className="px-3 py-3">{item.totalRows}</td>
                  <td className="px-3 py-3">{item.importedRows || 0}</td>
                  <td className="px-3 py-3">{item.duplicateRows || 0}</td>
                  <td className="px-3 py-3">{item.failedRows || 0}</td>
                  <td className="px-3 py-3">{formatDate(item.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!history.length && <p className="p-6 text-center text-sm text-slate-500">No imports yet.</p>}
        </div>
      </section>
    </div>
  );
}
