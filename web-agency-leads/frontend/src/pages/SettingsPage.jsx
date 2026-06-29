import { Bell, BrainCircuit, BriefcaseBusiness, DollarSign, KeyRound, Moon, Plus, Save, SlidersHorizontal, Trash2, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "../components/ui/Badge.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Input, Select, Textarea } from "../components/ui/Input.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useToast } from "../hooks/useToast.jsx";
import { api } from "../services/api.js";
import { formatDate } from "../utils/format.js";

const blankIndustry = {
  name: "",
  slug: "",
  description: "",
  defaultKeywords: "",
  auditCriteria: "",
  enabled: true,
  workspaceSections: { stats: true, recommendedServices: true, scannerTemplates: true, outreachDrafts: true, leads: true },
  scoringRule: { designWeight: 1, mobileWeight: 1, trustWeight: 1, ctaWeight: 1, seoWeight: 1, conversionWeight: 1, bookingWeight: 1, socialProofWeight: 1 },
  recommendedServiceIds: []
};

const blankService = {
  name: "",
  slug: "",
  description: "",
  baseMinValue: 0,
  baseMaxValue: 0,
  enabled: true
};

const blankKnowledgeForm = {
  businessType: "",
  industry: "",
  country: "",
  targetMarket: ""
};

const defaultOutreachEmailTemplate = {
  greetingTemplate: 'Hi {{contact.firstName || "there"}},',
  openingLineTemplate: "",
  closingQuestionTemplate: "",
  signOffTemplate: "Thanks,",
  signatureTemplate: "{{sender.name}}\n{{sender.title}}\n{{sender.company}}"
};

const outreachTemplateVariables = [
  "{{contact.firstName}}",
  "{{contact.name}}",
  "{{company.name}}",
  "{{company.website}}",
  "{{sender.name}}",
  "{{sender.title}}",
  "{{sender.company}}",
  "{{industry}}",
  "{{observation.category}}"
];

const scoringFields = [
  ["designWeight", "Design"],
  ["mobileWeight", "Mobile"],
  ["trustWeight", "Trust"],
  ["ctaWeight", "CTA"],
  ["seoWeight", "SEO"],
  ["conversionWeight", "Conversion"],
  ["bookingWeight", "Booking"],
  ["socialProofWeight", "Social proof"]
];

const notificationLabels = {
  hotLeadFound: "Hot lead found",
  scanFailed: "Scan failed",
  automationCompleted: "Automation completed",
  highValueLeadFound: "High-value lead found",
  replyReceived: "Reply received",
  meetingBooked: "Meeting booked"
};

function money(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function Section({ icon: Icon, title, description, children }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-5 flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
          <Icon size={18} />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label>
      <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
      {children}
    </label>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { push } = useToast();
  const [settings, setSettings] = useState(null);
  const [profile, setProfile] = useState({ name: "", email: "" });
  const [apiKeys, setApiKeys] = useState({ googlePlacesKey: "", openaiKey: "" });
  const [costTracking, setCostTracking] = useState({});
  const [darkMode, setDarkMode] = useState({ defaultTheme: "system" });
  const [notifications, setNotifications] = useState({});
  const [outreachPersona, setOutreachPersona] = useState({ enabled: false, assistantName: "", assistantTitle: "", assistantEmail: "", assistantAvatar: "", companyName: "Ocia Studio" });
  const [outreachPipeline, setOutreachPipeline] = useState({ minimumConfidence: 0.6, autoRewrite: true, maximumRewriteAttempts: 1, showDebug: false, qualityGateStrictness: "standard" });
  const [outreachEmailTemplate, setOutreachEmailTemplate] = useState(defaultOutreachEmailTemplate);
  const [knowledgeForm, setKnowledgeForm] = useState(blankKnowledgeForm);
  const [knowledgeModels, setKnowledgeModels] = useState([]);
  const [knowledgePreview, setKnowledgePreview] = useState(null);
  const [generatingKnowledge, setGeneratingKnowledge] = useState(false);
  const [selectedIndustryId, setSelectedIndustryId] = useState("");
  const [industryForm, setIndustryForm] = useState(blankIndustry);
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [serviceForm, setServiceForm] = useState(blankService);
  const [loading, setLoading] = useState(true);

  async function loadSettings() {
    setLoading(true);
    try {
      const { data } = await api.get("/settings");
      const knowledgeRes = await api.get("/outreach/knowledge").catch(() => ({ data: [] }));
      setSettings(data);
      setKnowledgeModels(knowledgeRes.data || []);
      setProfile({
        name: data.profile?.name || user?.name || "",
        email: data.profile?.email || user?.email || "",
        senderName: data.profile?.senderName || "",
        senderTitle: data.profile?.senderTitle || "",
        senderEmail: data.profile?.senderEmail || "",
        companyName: data.profile?.companyName || "Ocia Studio",
        signature: data.profile?.signature || "",
        profilePhoto: data.profile?.profilePhoto || ""
      });
      setApiKeys(data.apiKeys || {});
      setCostTracking(data.costTracking || {});
      setDarkMode(data.darkMode || { defaultTheme: "system" });
      setNotifications(data.notifications || {});
      setOutreachPersona(data.outreachPersona || { enabled: false, assistantName: "", assistantTitle: "", assistantEmail: "", assistantAvatar: "", companyName: "Ocia Studio" });
      setOutreachPipeline(data.outreachPipeline || { minimumConfidence: 0.6, autoRewrite: true, maximumRewriteAttempts: 1, showDebug: false, qualityGateStrictness: "standard" });
      setOutreachEmailTemplate({ ...defaultOutreachEmailTemplate, ...(data.outreachEmailTemplate || {}) });
      const firstIndustry = data.industries?.[0];
      const firstService = data.services?.[0];
      if (firstIndustry) selectIndustry(firstIndustry, data.services || []);
      if (firstService) selectService(firstService);
    } catch (error) {
      push(error.response?.data?.message || "Settings failed to load", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  const serviceOptions = settings?.services || [];
  const costSummary = settings?.costSummary || {};

  const selectedRecommended = useMemo(() => new Set(industryForm.recommendedServiceIds || []), [industryForm.recommendedServiceIds]);

  function selectIndustry(industry, services = serviceOptions) {
    setSelectedIndustryId(industry?.id || "");
    setIndustryForm(industry ? {
      ...blankIndustry,
      ...industry,
      defaultKeywords: industry.defaultKeywords || "",
      auditCriteria: industry.auditCriteria || "",
      scoringRule: { ...blankIndustry.scoringRule, ...(industry.scoringRule || {}) },
      workspaceSections: { ...blankIndustry.workspaceSections, ...(industry.workspaceSections || {}) },
      recommendedServiceIds: Array.isArray(industry.recommendedServiceIds) ? industry.recommendedServiceIds : services.filter((service) => service.enabled).slice(0, 2).map((service) => service.id)
    } : blankIndustry);
  }

  function selectService(service) {
    setSelectedServiceId(service?.id || "");
    setServiceForm(service ? { ...blankService, ...service } : blankService);
  }

  async function saveProfile() {
    await api.put("/settings/profile", profile);
    push("Profile saved");
    await loadSettings();
  }

  async function saveAppSettings() {
    const payload = {
      apiKeys,
      costTracking,
      darkMode,
      notifications,
      outreachPersona,
      outreachPipeline,
      outreachEmailTemplate
    };
    const { data } = await api.put("/settings/app", payload);
    setSettings(data);
    push("Settings saved");
  }

  async function saveIndustry() {
    const payload = {
      ...industryForm,
      recommendedServiceIds: Array.from(selectedRecommended)
    };
    if (selectedIndustryId) await api.put(`/settings/industries/${selectedIndustryId}`, payload);
    else await api.post("/settings/industries", payload);
    push("Industry saved");
    await loadSettings();
  }

  async function deleteIndustry() {
    if (!selectedIndustryId) return;
    await api.delete(`/settings/industries/${selectedIndustryId}`);
    push("Industry removed or disabled");
    setSelectedIndustryId("");
    setIndustryForm(blankIndustry);
    await loadSettings();
  }

  async function saveService() {
    if (selectedServiceId) await api.put(`/settings/services/${selectedServiceId}`, serviceForm);
    else await api.post("/settings/services", serviceForm);
    push("Service saved");
    await loadSettings();
  }

  async function deleteService() {
    if (!selectedServiceId) return;
    await api.delete(`/settings/services/${selectedServiceId}`);
    push("Service removed or disabled");
    setSelectedServiceId("");
    setServiceForm(blankService);
    await loadSettings();
  }

  async function generateKnowledgeModel(force = false) {
    if (!knowledgeForm.businessType && !knowledgeForm.industry) return push("Add a business type or industry first", "error");
    setGeneratingKnowledge(true);
    try {
      const { data } = await api.post("/outreach/knowledge", { ...knowledgeForm, force });
      setKnowledgePreview(data);
      push(force ? "Knowledge model regenerated" : "Knowledge model ready");
      const list = await api.get("/outreach/knowledge");
      setKnowledgeModels(list.data || []);
    } catch (error) {
      push(error.response?.data?.message || "Could not generate knowledge model", "error");
    } finally {
      setGeneratingKnowledge(false);
    }
  }

  function toggleRecommendedService(serviceId) {
    const next = new Set(selectedRecommended);
    if (next.has(serviceId)) next.delete(serviceId);
    else next.add(serviceId);
    setIndustryForm({ ...industryForm, recommendedServiceIds: Array.from(next) });
  }

  function updateRule(key, value) {
    setIndustryForm({ ...industryForm, scoringRule: { ...industryForm.scoringRule, [key]: value } });
  }

  function updateSection(key) {
    setIndustryForm({ ...industryForm, workspaceSections: { ...industryForm.workspaceSections, [key]: !industryForm.workspaceSections?.[key] } });
  }

  if (loading && !settings) return <p className="text-sm text-slate-500">Loading settings...</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">Admin controls</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Settings</h1>
          <p className="mt-2 max-w-2xl text-slate-500">Manage your workspace, services, cost assumptions, scoring weights, and industry workspaces.</p>
        </div>
        <Button onClick={saveAppSettings}><Save size={16} /> Save global settings</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          ["Google Places", money(costSummary.googlePlacesCost)],
          ["OpenAI", money(costSummary.openAiCost)],
          ["Cost / scan", money(costSummary.costPerScan)],
          ["Cost / qualified lead", money(costSummary.costPerQualifiedLead)],
          ["Tokens used", Number(costSummary.tokensUsed || 0).toLocaleString()],
          ["Scans run", Number(costSummary.scansRun || 0).toLocaleString()]
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section icon={UsersRound} title="Profile" description="Your admin identity and sender profile for manual outreach.">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Name"><Input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></Field>
            <Field label="Email"><Input value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></Field>
            <Field label="Sender name"><Input value={profile.senderName || ""} onChange={(e) => setProfile({ ...profile, senderName: e.target.value })} placeholder={profile.name || "Your name"} /></Field>
            <Field label="Sender title"><Input value={profile.senderTitle || ""} onChange={(e) => setProfile({ ...profile, senderTitle: e.target.value })} placeholder="Founder" /></Field>
            <Field label="Sender email"><Input value={profile.senderEmail || ""} onChange={(e) => setProfile({ ...profile, senderEmail: e.target.value })} placeholder={profile.email || "hello@ocia.studio"} /></Field>
            <Field label="Company name"><Input value={profile.companyName || ""} onChange={(e) => setProfile({ ...profile, companyName: e.target.value })} placeholder="Ocia Studio" /></Field>
            <Field label="Profile photo URL"><Input value={profile.profilePhoto || ""} onChange={(e) => setProfile({ ...profile, profilePhoto: e.target.value })} placeholder="Optional" /></Field>
            <Field label="Signature"><Textarea value={profile.signature || ""} onChange={(e) => setProfile({ ...profile, signature: e.target.value })} placeholder={`${profile.senderName || profile.name || "Your name"}\nFounder\nOcia Studio`} /></Field>
          </div>
          <Button className="mt-4" variant="secondary" onClick={saveProfile}><Save size={16} /> Save profile</Button>
        </Section>

        <Section icon={UsersRound} title="Team / users" description="Current admins and future teammate slots.">
          <div className="space-y-2">
            {(settings?.users || []).map((member) => (
              <div key={member.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 p-3 dark:border-slate-800">
                <div>
                  <p className="font-semibold">{member.name}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{member.email}</p>
                </div>
                <Badge className="bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700">{member.role}</Badge>
              </div>
            ))}
          </div>
        </Section>

        <Section icon={KeyRound} title="API keys" description="Stored in DB for now; production can swap this to encrypted secrets later.">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Google Places API key"><Input value={apiKeys.googlePlacesKey || ""} onChange={(e) => setApiKeys({ ...apiKeys, googlePlacesKey: e.target.value })} placeholder="Paste or leave existing saved key" /></Field>
            <Field label="OpenAI API key"><Input value={apiKeys.openaiKey || ""} onChange={(e) => setApiKeys({ ...apiKeys, openaiKey: e.target.value })} placeholder="Paste or leave existing saved key" /></Field>
          </div>
        </Section>

        <Section icon={DollarSign} title="Cost tracking" description="Track cost assumptions and current usage totals.">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Google Places cost"><Input type="number" step="0.001" value={costTracking.googlePlacesCost || 0} onChange={(e) => setCostTracking({ ...costTracking, googlePlacesCost: e.target.value })} /></Field>
            <Field label="OpenAI cost"><Input type="number" step="0.001" value={costTracking.openAiCost || 0} onChange={(e) => setCostTracking({ ...costTracking, openAiCost: e.target.value })} /></Field>
            <Field label="Tokens used"><Input type="number" value={costTracking.tokensUsed || 0} onChange={(e) => setCostTracking({ ...costTracking, tokensUsed: e.target.value })} /></Field>
            <Field label="OpenAI cost / 1k tokens"><Input type="number" step="0.001" value={costTracking.openAiCostPerThousandTokens || 0} onChange={(e) => setCostTracking({ ...costTracking, openAiCostPerThousandTokens: e.target.value })} /></Field>
          </div>
        </Section>
      </div>

      <Section icon={BriefcaseBusiness} title="Industries" description="Configure industry workspaces, keywords, audit criteria, scoring rules, and visible workspace sections.">
        <div className="grid gap-5 xl:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            <Button className="w-full" variant="secondary" onClick={() => selectIndustry(null)}><Plus size={16} /> New industry</Button>
            {(settings?.industries || []).map((industry) => (
              <button key={industry.id} onClick={() => selectIndustry(industry)} className={`w-full rounded-2xl border p-3 text-left transition ${selectedIndustryId === industry.id ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 hover:bg-slate-50"}`}>
                <p className="font-semibold">{industry.name}</p>
                <p className={`text-xs ${selectedIndustryId === industry.id ? "text-slate-300" : "text-slate-500"}`}>{industry.slug}</p>
              </button>
            ))}
          </div>
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Industry name"><Input value={industryForm.name} onChange={(e) => setIndustryForm({ ...industryForm, name: e.target.value })} /></Field>
              <Field label="Slug"><Input value={industryForm.slug} onChange={(e) => setIndustryForm({ ...industryForm, slug: e.target.value })} /></Field>
              <Field label="Default keywords"><Textarea value={industryForm.defaultKeywords || ""} onChange={(e) => setIndustryForm({ ...industryForm, defaultKeywords: e.target.value })} placeholder="salon, spa, aesthetics clinic" /></Field>
              <Field label="Audit criteria"><Textarea value={industryForm.auditCriteria || ""} onChange={(e) => setIndustryForm({ ...industryForm, auditCriteria: e.target.value })} placeholder="Booking, visuals, reviews, trust, before/after proof..." /></Field>
              <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={industryForm.enabled !== false} onChange={(e) => setIndustryForm({ ...industryForm, enabled: e.target.checked })} /> Enabled workspace</label>
            </div>

            <div>
              <h3 className="mb-3 flex items-center gap-2 font-semibold"><SlidersHorizontal size={16} /> Scoring weights</h3>
              <div className="grid gap-3 md:grid-cols-4">
                {scoringFields.map(([key, label]) => (
                  <Field key={key} label={label}><Input type="number" step="0.05" min="0" value={industryForm.scoringRule?.[key] ?? 1} onChange={(e) => updateRule(key, e.target.value)} /></Field>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-3 font-semibold">Recommended services</h3>
              <div className="flex flex-wrap gap-2">
                {serviceOptions.map((service) => (
                  <button key={service.id} type="button" onClick={() => toggleRecommendedService(service.id)} className={`rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ring-inset transition ${selectedRecommended.has(service.id) ? "bg-slate-950 text-white ring-slate-950" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"}`}>
                    {service.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-3 font-semibold">Workspace sections</h3>
              <div className="grid gap-2 md:grid-cols-3">
                {Object.keys(blankIndustry.workspaceSections).map((key) => (
                  <label key={key} className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm font-medium">
                    <input type="checkbox" checked={Boolean(industryForm.workspaceSections?.[key])} onChange={() => updateSection(key)} />
                    {key.replace(/([A-Z])/g, " $1")}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={saveIndustry}><Save size={16} /> Save industry</Button>
              {selectedIndustryId && <Button variant="danger" onClick={deleteIndustry}><Trash2 size={16} /> Delete / disable</Button>}
            </div>
          </div>
        </div>
      </Section>

      <Section icon={BriefcaseBusiness} title="Services" description="Manage sellable services and default value ranges used for service opportunities.">
        <div className="grid gap-5 xl:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            <Button className="w-full" variant="secondary" onClick={() => selectService(null)}><Plus size={16} /> New service</Button>
            {(settings?.services || []).map((service) => (
              <button key={service.id} onClick={() => selectService(service)} className={`w-full rounded-2xl border p-3 text-left transition ${selectedServiceId === service.id ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 hover:bg-slate-50"}`}>
                <p className="font-semibold">{service.name}</p>
                <p className={`text-xs ${selectedServiceId === service.id ? "text-slate-300" : "text-slate-500"}`}>{money(service.baseMinValue)} - {money(service.baseMaxValue)}</p>
              </button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Service name"><Input value={serviceForm.name} onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })} /></Field>
            <Field label="Slug"><Input value={serviceForm.slug} onChange={(e) => setServiceForm({ ...serviceForm, slug: e.target.value })} /></Field>
            <Field label="Base min value"><Input type="number" value={serviceForm.baseMinValue} onChange={(e) => setServiceForm({ ...serviceForm, baseMinValue: e.target.value })} /></Field>
            <Field label="Base max value"><Input type="number" value={serviceForm.baseMaxValue} onChange={(e) => setServiceForm({ ...serviceForm, baseMaxValue: e.target.value })} /></Field>
            <Field label="Description"><Textarea value={serviceForm.description || ""} onChange={(e) => setServiceForm({ ...serviceForm, description: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={serviceForm.enabled !== false} onChange={(e) => setServiceForm({ ...serviceForm, enabled: e.target.checked })} /> Enabled service</label>
            <div className="flex flex-wrap gap-3 md:col-span-2">
              <Button onClick={saveService}><Save size={16} /> Save service</Button>
              {selectedServiceId && <Button variant="danger" onClick={deleteService}><Trash2 size={16} /> Delete / disable</Button>}
            </div>
          </div>
        </div>
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section icon={BrainCircuit} title="Outreach intelligence Phase 0" description="Build reusable business knowledge before scanning websites. This teaches Ocia what matters for each business type.">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Business type"><Input value={knowledgeForm.businessType} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, businessType: e.target.value })} placeholder="Dental clinic, restaurant, law firm..." /></Field>
              <Field label="Industry"><Input value={knowledgeForm.industry} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, industry: e.target.value })} placeholder="Healthcare, hospitality, legal..." /></Field>
              <Field label="Country"><Input value={knowledgeForm.country} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, country: e.target.value })} placeholder="Singapore" /></Field>
              <Field label="Target market"><Input value={knowledgeForm.targetMarket} onChange={(e) => setKnowledgeForm({ ...knowledgeForm, targetMarket: e.target.value })} placeholder="Local consumers, high-income homeowners..." /></Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={generatingKnowledge} onClick={() => generateKnowledgeModel(false)}><BrainCircuit size={16} /> {generatingKnowledge ? "Generating..." : "Generate model"}</Button>
              <Button variant="secondary" disabled={generatingKnowledge} onClick={() => generateKnowledgeModel(true)}>Regenerate</Button>
            </div>
            {knowledgePreview && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Latest model</p>
                <h3 className="mt-1 font-semibold">{knowledgePreview.businessType}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{knowledgePreview.summary}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(knowledgePreview.observationPriorities || []).slice(0, 5).map((item) => <Badge key={item} className="bg-white text-slate-700 ring-slate-200">{item}</Badge>)}
                </div>
              </div>
            )}
            <div>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Saved models</h3>
              <div className="space-y-2">
                {knowledgeModels.slice(0, 4).map(({ key, model, updatedAt }) => (
                  <button key={key} type="button" onClick={() => setKnowledgePreview(model)} className="w-full rounded-2xl border border-slate-200 p-3 text-left transition hover:bg-slate-50">
                    <p className="font-semibold">{model.businessType || model.input?.businessType || "Business model"}</p>
                    <p className="mt-1 text-xs text-slate-500">{model.input?.country || "Any country"} · updated {formatDate(updatedAt)}</p>
                  </button>
                ))}
                {!knowledgeModels.length && <p className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">No Phase 0 knowledge models yet.</p>}
              </div>
            </div>
          </div>
        </Section>

        <Section icon={UsersRound} title="Outreach persona" description="Optional team persona for signing generated emails instead of the logged-in user's sender profile.">
          <div className="space-y-4">
            <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm font-medium dark:border-slate-800">
              Enable persona
              <input type="checkbox" checked={outreachPersona.enabled === true} onChange={(e) => setOutreachPersona({ ...outreachPersona, enabled: e.target.checked })} />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Assistant name"><Input value={outreachPersona.assistantName || ""} onChange={(e) => setOutreachPersona({ ...outreachPersona, assistantName: e.target.value })} placeholder="Alex" /></Field>
              <Field label="Assistant title"><Input value={outreachPersona.assistantTitle || ""} onChange={(e) => setOutreachPersona({ ...outreachPersona, assistantTitle: e.target.value })} placeholder="Client Success" /></Field>
              <Field label="Assistant email"><Input value={outreachPersona.assistantEmail || ""} onChange={(e) => setOutreachPersona({ ...outreachPersona, assistantEmail: e.target.value })} placeholder="hello@ocia.studio" /></Field>
              <Field label="Company name"><Input value={outreachPersona.companyName || ""} onChange={(e) => setOutreachPersona({ ...outreachPersona, companyName: e.target.value })} placeholder="Ocia Studio" /></Field>
              <Field label="Assistant avatar URL"><Input value={outreachPersona.assistantAvatar || ""} onChange={(e) => setOutreachPersona({ ...outreachPersona, assistantAvatar: e.target.value })} placeholder="Optional" /></Field>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">Keep this as a simple Ocia team identity. The generator will not invent fake credentials or company history.</p>
          </div>
        </Section>

        <Section icon={SlidersHorizontal} title="Outreach email template" description="Control the reusable greeting, opening, closing, and signature wrapped around the generated core insight.">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Greeting template">
                <Textarea
                  className="min-h-20"
                  value={outreachEmailTemplate.greetingTemplate || ""}
                  onChange={(e) => setOutreachEmailTemplate({ ...outreachEmailTemplate, greetingTemplate: e.target.value })}
                  placeholder={'Hi {{contact.firstName || "there"}},'}
                />
              </Field>
              <Field label="Opening line template">
                <Textarea
                  className="min-h-20"
                  value={outreachEmailTemplate.openingLineTemplate || ""}
                  onChange={(e) => setOutreachEmailTemplate({ ...outreachEmailTemplate, openingLineTemplate: e.target.value })}
                  placeholder="Optional line before the AI-written core insight"
                />
              </Field>
              <Field label="Closing question template">
                <Textarea
                  className="min-h-20"
                  value={outreachEmailTemplate.closingQuestionTemplate || ""}
                  onChange={(e) => setOutreachEmailTemplate({ ...outreachEmailTemplate, closingQuestionTemplate: e.target.value })}
                  placeholder="Was that intentional?"
                />
              </Field>
              <Field label="Sign-off template">
                <Textarea
                  className="min-h-20"
                  value={outreachEmailTemplate.signOffTemplate || ""}
                  onChange={(e) => setOutreachEmailTemplate({ ...outreachEmailTemplate, signOffTemplate: e.target.value })}
                  placeholder="Thanks,"
                />
              </Field>
              <Field label="Signature template">
                <Textarea
                  className="min-h-28"
                  value={outreachEmailTemplate.signatureTemplate || ""}
                  onChange={(e) => setOutreachEmailTemplate({ ...outreachEmailTemplate, signatureTemplate: e.target.value })}
                  placeholder={"{{sender.name}}\n{{sender.title}}\n{{sender.company}}"}
                />
              </Field>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                <p className="text-sm font-semibold">Supported variables</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {outreachTemplateVariables.map((variable) => (
                    <code key={variable} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">{variable}</code>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">Use a fallback like <code>{'{{contact.firstName || "there"}}'}</code> when a value might be missing.</p>
              </div>
            </div>
          </div>
        </Section>

        <Section icon={SlidersHorizontal} title="Outreach pipeline" description="Advanced controls for the Analyze → Review → Send workflow. These stay out of the main screen.">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Minimum confidence">
              <Input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={outreachPipeline.minimumConfidence ?? 0.6}
                onChange={(e) => setOutreachPipeline({ ...outreachPipeline, minimumConfidence: e.target.value })}
              />
            </Field>
            <Field label="Maximum rewrite attempts">
              <Input
                type="number"
                min="0"
                max="3"
                value={outreachPipeline.maximumRewriteAttempts ?? 1}
                onChange={(e) => setOutreachPipeline({ ...outreachPipeline, maximumRewriteAttempts: e.target.value })}
              />
            </Field>
            <Field label="Quality gate strictness">
              <Select value={outreachPipeline.qualityGateStrictness || "standard"} onChange={(e) => setOutreachPipeline({ ...outreachPipeline, qualityGateStrictness: e.target.value })}>
                <option value="relaxed">Relaxed</option>
                <option value="standard">Standard</option>
                <option value="strict">Strict</option>
              </Select>
            </Field>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm font-medium dark:border-slate-800">
              Auto rewrite after failed quality gate
              <input type="checkbox" checked={outreachPipeline.autoRewrite !== false} onChange={(e) => setOutreachPipeline({ ...outreachPipeline, autoRewrite: e.target.checked })} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm font-medium dark:border-slate-800 md:col-span-2">
              Show debug panels by default
              <input type="checkbox" checked={outreachPipeline.showDebug === true} onChange={(e) => setOutreachPipeline({ ...outreachPipeline, showDebug: e.target.checked })} />
            </label>
          </div>
        </Section>

        <Section icon={Moon} title="Dark mode" description="Set the default theme preference for this workspace.">
          <Select value={darkMode.defaultTheme || "system"} onChange={(e) => setDarkMode({ ...darkMode, defaultTheme: e.target.value })}>
            <option value="system">System default</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Select>
        </Section>

        <Section icon={Bell} title="Notifications" description="Choose which event types should appear in the notification center.">
          <div className="grid gap-2 md:grid-cols-2">
            {Object.entries(notificationLabels).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm font-medium dark:border-slate-800">
                {label}
                <input type="checkbox" checked={notifications[key] !== false} onChange={(e) => setNotifications({ ...notifications, [key]: e.target.checked })} />
              </label>
            ))}
          </div>
        </Section>
      </div>

      <p className="text-xs text-slate-400">Last refreshed {formatDate(new Date().toISOString())}</p>
    </div>
  );
}
