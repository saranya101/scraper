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
  location: "",
  screenshotPath: "",
  mobileScreenshotPath: "",
  score: 7,
  opportunityScore: "",
  visualDesignScore: "",
  mobileScore: "",
  trustScore: "",
  ctaScore: "",
  seoScore: "",
  estimatedProjectValue: "",
  websiteStatus: "UNKNOWN",
  status: "NOT_CONTACTED",
  outreachEmail: "",
  issues: "",
  recommendedFixes: ""
};

export default function LeadFormModal({ lead, onClose, onSave }) {
  const [form, setForm] = useState(emptyLead);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (lead) {
      setForm({
        ...emptyLead,
        ...lead,
        issues: lead.issues?.map((issue) => issue.issueText || issue).join("\n") || "",
        recommendedFixes: Array.isArray(lead.recommendedFixes) ? lead.recommendedFixes.join("\n") : ""
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
        opportunityScore: form.opportunityScore === "" ? null : Number(form.opportunityScore),
        visualDesignScore: form.visualDesignScore === "" ? null : Number(form.visualDesignScore),
        mobileScore: form.mobileScore === "" ? null : Number(form.mobileScore),
        trustScore: form.trustScore === "" ? null : Number(form.trustScore),
        ctaScore: form.ctaScore === "" ? null : Number(form.ctaScore),
        seoScore: form.seoScore === "" ? null : Number(form.seoScore),
        issues: form.issues.split("\n").map((item) => item.trim()).filter(Boolean),
        recommendedFixes: form.recommendedFixes.split("\n").map((item) => item.trim()).filter(Boolean)
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
            <span className="mb-1.5 block text-sm font-medium">Location</span>
            <Input value={form.location || ""} onChange={(event) => setForm({ ...form, location: event.target.value })} />
          </label>
          <label>
            <span className="mb-1.5 block text-sm font-medium">Score</span>
            <Input type="number" min="1" max="10" value={form.score} onChange={(event) => setForm({ ...form, score: event.target.value })} />
          </label>
          {[
            ["Opportunity score", "opportunityScore"],
            ["Visual score", "visualDesignScore"],
            ["Mobile score", "mobileScore"],
            ["Trust score", "trustScore"],
            ["CTA score", "ctaScore"],
            ["SEO score", "seoScore"]
          ].map(([label, key]) => (
            <label key={key}>
              <span className="mb-1.5 block text-sm font-medium">{label}</span>
              <Input type="number" min="1" max="10" value={form[key] || ""} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
            </label>
          ))}
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
          <label>
            <span className="mb-1.5 block text-sm font-medium">Website status</span>
            <Select value={form.websiteStatus || "UNKNOWN"} onChange={(event) => setForm({ ...form, websiteStatus: event.target.value })}>
              <option value="UNKNOWN">Unknown</option>
              <option value="WORKING">Working</option>
              <option value="CLOUDFLARE">Cloudflare</option>
              <option value="CAPTCHA">CAPTCHA</option>
              <option value="FORBIDDEN">403 Forbidden</option>
              <option value="NOT_FOUND">404 Not Found</option>
              <option value="SERVER_ERROR">500 Server Error</option>
              <option value="SSL_ERROR">SSL Error</option>
              <option value="TIMEOUT">Timeout</option>
              <option value="REDIRECT_LOOP">Redirect Loop</option>
              <option value="DOMAIN_PARKED">Domain Parked</option>
              <option value="WEBSITE_OFFLINE">Offline</option>
              <option value="NO_WEBSITE">No Website</option>
              <option value="BOT_PROTECTION">Bot Protection</option>
            </Select>
          </label>
          <label className="md:col-span-2">
            <span className="mb-1.5 block text-sm font-medium">Screenshot path</span>
            <Input value={form.screenshotPath || ""} onChange={(event) => setForm({ ...form, screenshotPath: event.target.value })} placeholder="/screenshots/company.png" />
          </label>
          <label className="md:col-span-2">
            <span className="mb-1.5 block text-sm font-medium">Mobile screenshot path</span>
            <Input value={form.mobileScreenshotPath || ""} onChange={(event) => setForm({ ...form, mobileScreenshotPath: event.target.value })} />
          </label>
          <label className="md:col-span-2">
            <span className="mb-1.5 block text-sm font-medium">Estimated project value</span>
            <Input value={form.estimatedProjectValue || ""} onChange={(event) => setForm({ ...form, estimatedProjectValue: event.target.value })} />
          </label>
          <label className="md:col-span-2">
            <span className="mb-1.5 block text-sm font-medium">Issues, one per line</span>
            <Textarea value={form.issues} onChange={(event) => setForm({ ...form, issues: event.target.value })} />
          </label>
          <label className="md:col-span-2">
            <span className="mb-1.5 block text-sm font-medium">Outreach email</span>
            <Textarea value={form.outreachEmail || ""} onChange={(event) => setForm({ ...form, outreachEmail: event.target.value })} />
          </label>
          <label className="md:col-span-2">
            <span className="mb-1.5 block text-sm font-medium">Recommended fixes, one per line</span>
            <Textarea value={form.recommendedFixes || ""} onChange={(event) => setForm({ ...form, recommendedFixes: event.target.value })} />
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
