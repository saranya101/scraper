import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./ui/Button.jsx";
import { Input, Select, Textarea } from "./ui/Input.jsx";

const emptyLead = {
  company: "",
  website: "",
  phone: "",
  address: "",
  industry: "",
  screenshotPath: "",
  score: 7,
  status: "NOT_CONTACTED",
  outreachEmail: "",
  issues: ""
};

export default function LeadFormModal({ lead, onClose, onSave }) {
  const [form, setForm] = useState(emptyLead);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (lead) {
      setForm({
        ...emptyLead,
        ...lead,
        issues: lead.issues?.map((issue) => issue.issueText || issue).join("\n") || ""
      });
    } else {
      setForm(emptyLead);
    }
  }, [lead]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({
        ...form,
        score: Number(form.score),
        issues: form.issues.split("\n").map((item) => item.trim()).filter(Boolean)
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-3xl bg-white p-6 shadow-glow">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{lead ? "Edit lead" : "Create lead"}</h2>
            <p className="text-sm text-slate-500">Keep the audit record crisp and ready for outreach.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100" aria-label="Close modal">
            <X size={18} />
          </button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label>
            <span className="mb-1.5 block text-sm font-medium">Company</span>
            <Input value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} required />
          </label>
          <label>
            <span className="mb-1.5 block text-sm font-medium">Website</span>
            <Input value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} required />
          </label>
          <label>
            <span className="mb-1.5 block text-sm font-medium">Phone</span>
            <Input value={form.phone || ""} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          </label>
          <label>
            <span className="mb-1.5 block text-sm font-medium">Industry</span>
            <Input value={form.industry || ""} onChange={(event) => setForm({ ...form, industry: event.target.value })} />
          </label>
          <label className="md:col-span-2">
            <span className="mb-1.5 block text-sm font-medium">Address</span>
            <Input value={form.address || ""} onChange={(event) => setForm({ ...form, address: event.target.value })} />
          </label>
          <label>
            <span className="mb-1.5 block text-sm font-medium">Score</span>
            <Input type="number" min="1" max="10" value={form.score} onChange={(event) => setForm({ ...form, score: event.target.value })} />
          </label>
          <label>
            <span className="mb-1.5 block text-sm font-medium">Status</span>
            <Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              <option value="NOT_CONTACTED">Not Contacted</option>
              <option value="CONTACTED">Contacted</option>
              <option value="REPLIED">Replied</option>
              <option value="CLOSED">Closed</option>
              <option value="ARCHIVED">Archived</option>
            </Select>
          </label>
          <label className="md:col-span-2">
            <span className="mb-1.5 block text-sm font-medium">Screenshot path</span>
            <Input value={form.screenshotPath || ""} onChange={(event) => setForm({ ...form, screenshotPath: event.target.value })} placeholder="/screenshots/company.png" />
          </label>
          <label className="md:col-span-2">
            <span className="mb-1.5 block text-sm font-medium">Issues, one per line</span>
            <Textarea value={form.issues} onChange={(event) => setForm({ ...form, issues: event.target.value })} />
          </label>
          <label className="md:col-span-2">
            <span className="mb-1.5 block text-sm font-medium">Outreach email</span>
            <Textarea value={form.outreachEmail || ""} onChange={(event) => setForm({ ...form, outreachEmail: event.target.value })} />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={saving}>{saving ? "Saving..." : "Save lead"}</Button>
        </div>
      </form>
    </div>
  );
}
