import { FileSpreadsheet, UploadCloud } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/Button.jsx";
import { useToast } from "../hooks/useToast.jsx";
import { api } from "../services/api.js";

export default function ImportPage() {
  const { push } = useToast();
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function upload(event) {
    event.preventDefault();
    if (!file) return push("Choose a CSV or XLSX file first", "error");
    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const { data } = await api.post("/imports/upload", formData, { headers: { "Content-Type": "multipart/form-data" } });
      setResult(data);
      push("Import complete");
    } catch (error) {
      push(error.response?.data?.message || "Import failed", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">Bulk intake</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Import leads</h1>
        <p className="mt-2 max-w-2xl text-slate-500">Upload `leads.csv` or `audited_leads.xlsx`. Columns are mapped automatically and duplicate websites are skipped.</p>
      </div>
      <form onSubmit={upload} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <label className="grid min-h-72 cursor-pointer place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center transition hover:border-slate-400 hover:bg-white">
          <input type="file" accept=".csv,.xlsx" className="sr-only" onChange={(event) => setFile(event.target.files?.[0] || null)} />
          <div>
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-slate-950 text-white">
              {file ? <FileSpreadsheet size={24} /> : <UploadCloud size={24} />}
            </div>
            <h3 className="text-lg font-semibold">{file ? file.name : "Drop in a CSV/XLSX export"}</h3>
            <p className="mt-2 text-sm text-slate-500">Supported fields: company, website, phone, address, industry, score, issues, outreach email.</p>
          </div>
        </label>
        <div className="mt-5 flex justify-end">
          <Button disabled={loading}>{loading ? "Importing..." : "Upload and import"}</Button>
        </div>
      </form>
      {result && (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Rows scanned</p>
            <p className="mt-2 text-3xl font-semibold">{result.totalRows}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Created</p>
            <p className="mt-2 text-3xl font-semibold text-emerald-600">{result.created}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Skipped duplicates</p>
            <p className="mt-2 text-3xl font-semibold text-amber-600">{result.skipped}</p>
          </div>
        </div>
      )}
    </div>
  );
}
