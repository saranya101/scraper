import { Activity, Bell, CalendarClock, CheckCircle2, Loader2, Mail, Pause, Play, Plus, RefreshCw, Save, Settings2, ShieldCheck, SquareCheckBig, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "../components/ui/Badge.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Input, Select } from "../components/ui/Input.jsx";
import { useToast } from "../hooks/useToast.jsx";
import { api } from "../services/api.js";
import { formatDate } from "../utils/format.js";

const emptyForm = {
  name: "",
  templateId: "",
  frequency: "DAILY",
  enabled: true,
  nextRunAt: ""
};

const runStages = ["Scheduled", "Scanning", "Visiting Websites", "Screenshotting", "AI Audit", "Ranking", "Outreach Generated", "Imported"];

function stageIndex(stage) {
  const index = runStages.indexOf(stage);
  if (stage === "Scan failed") return -1;
  return index >= 0 ? index : 0;
}

function money(value) {
  return `$${Number(value || 0).toLocaleString()}`;
}

function toLocalInput(value) {
  if (!value) return "";
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function fromLocalInput(value) {
  return value ? new Date(value).toISOString() : null;
}

export default function AutomationPage() {
  const { push } = useToast();
  const [schedules, setSchedules] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [dashboard, setDashboard] = useState({});
  const [automationSettings, setAutomationSettings] = useState(null);
  const [performance, setPerformance] = useState([]);
  const [diagnostics, setDiagnostics] = useState({});
  const [jobs, setJobs] = useState([]);
  const [inbox, setInbox] = useState({ needsAction: [], followUpReminders: { items: [] } });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [syncingReplies, setSyncingReplies] = useState(false);
  const [togglingPause, setTogglingPause] = useState(false);
  const [processingLeads, setProcessingLeads] = useState(false);
  const [sendingApproved, setSendingApproved] = useState(false);
  const [processingFollowUps, setProcessingFollowUps] = useState(false);
  const [runningScannerImport, setRunningScannerImport] = useState(false);

  async function loadAutomation() {
    const [schedulesRes, templatesRes, notificationsRes, dashboardRes, settingsRes, jobsRes, inboxRes, performanceRes, diagnosticsRes] = await Promise.all([
      api.get("/automation/schedules"),
      api.get("/scanner/templates"),
      api.get("/automation/notifications"),
      api.get("/automation/dashboard"),
      api.get("/automation/settings"),
      api.get("/automation/jobs"),
      api.get("/automation/inbox"),
      api.get("/automation/performance"),
      api.get("/automation/diagnostics")
    ]);
    setSchedules(schedulesRes.data);
    setTemplates(templatesRes.data);
    setNotifications(notificationsRes.data);
    setDashboard(dashboardRes.data);
    setAutomationSettings(settingsRes.data);
    setJobs(jobsRes.data);
    setInbox(inboxRes.data);
    setPerformance(performanceRes.data);
    setDiagnostics(diagnosticsRes.data);
  }

  useEffect(() => {
    loadAutomation().catch(() => push("Could not load automation", "error"));
  }, []);

  useEffect(() => {
    const hasActiveRun = schedules.some((schedule) => ["QUEUED", "RUNNING", "PENDING"].includes(schedule.latestRun?.status));
    if (!hasActiveRun) return undefined;
    const timer = setInterval(() => loadAutomation().catch(() => {}), 3000);
    return () => clearInterval(timer);
  }, [JSON.stringify(schedules.map((schedule) => schedule.latestRun?.status || ""))]);

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm, templateId: templates[0]?.id || "" });
    setModalOpen(true);
  }

  function openEdit(schedule) {
    setEditing(schedule);
    setForm({
      name: schedule.name,
      templateId: schedule.templateId,
      frequency: schedule.frequency,
      enabled: schedule.enabled,
      nextRunAt: toLocalInput(schedule.nextRunAt)
    });
    setModalOpen(true);
  }

  async function saveSchedule(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        nextRunAt: fromLocalInput(form.nextRunAt)
      };
      if (editing) {
        await api.put(`/automation/schedules/${editing.id}`, payload);
        push("Schedule updated");
      } else {
        await api.post("/automation/schedules", payload);
        push("Schedule created");
      }
      setModalOpen(false);
      await loadAutomation();
    } catch (error) {
      push(error.response?.data?.message || "Could not save schedule", "error");
    } finally {
      setSaving(false);
    }
  }

  async function toggleSchedule(schedule) {
    await api.put(`/automation/schedules/${schedule.id}`, { enabled: !schedule.enabled });
    push(!schedule.enabled ? "Schedule enabled" : "Schedule disabled");
    loadAutomation();
  }

  async function runNow(schedule) {
    try {
      await api.post(`/automation/run/${schedule.id}`);
      push("Automation run queued");
      await loadAutomation();
    } catch (error) {
      push(error.response?.data?.message || "Could not run schedule", "error");
    }
  }

  async function pauseSchedule(schedule) {
    await api.post(`/automation/pause/${schedule.id}`);
    push("Automation paused");
    loadAutomation();
  }

  async function finishSchedule(schedule) {
    await api.post(`/automation/finish/${schedule.id}`);
    push("Automation marked finished");
    loadAutomation();
  }

  async function deleteSchedule(schedule) {
    if (!confirm(`Delete ${schedule.name}?`)) return;
    await api.delete(`/automation/schedules/${schedule.id}`);
    push("Schedule deleted");
    loadAutomation();
  }

  async function markRead(notification) {
    await api.put(`/automation/notifications/${notification.id}/read`);
    loadAutomation();
  }

  async function saveAutomationSettings(event) {
    event.preventDefault();
    if (!automationSettings) return;
    setSavingSettings(true);
    try {
      await api.patch("/automation/settings", {
        ...automationSettings,
        dailySendLimit: Number(automationSettings.dailySendLimit || 30),
        hourlySendLimit: Number(automationSettings.hourlySendLimit || 10),
        dailyFollowUpLimit: Number(automationSettings.dailyFollowUpLimit || 30),
        hourlyFollowUpLimit: Number(automationSettings.hourlyFollowUpLimit || 10),
        batchSize: Number(automationSettings.batchSize || 10),
        minimumLeadQualityScore: Number(automationSettings.minimumLeadQualityScore || 8),
        minimumReportQualityScore: Number(automationSettings.minimumReportQualityScore || 8),
        minimumEmailQualityScore: Number(automationSettings.minimumEmailQualityScore || 8),
        allowedIndustries: String(automationSettings.allowedIndustries || "")
          .split(/,|\n/g)
          .map((item) => item.trim())
          .filter(Boolean),
        blockedIndustries: String(automationSettings.blockedIndustries || "")
          .split(/,|\n/g)
          .map((item) => item.trim())
          .filter(Boolean)
      });
      push("Automation settings saved");
      await loadAutomation();
    } catch (error) {
      push(error.response?.data?.message || "Could not save automation settings", "error");
    } finally {
      setSavingSettings(false);
    }
  }

  async function runAutomationNow() {
    setRunningNow(true);
    try {
      const response = await api.post("/automation/run-now");
      push(`Automation queued: ${response.data.queued || 0} schedule(s) started${response.data.failed ? `, ${response.data.failed} failed` : ""}.`);
      await loadAutomation();
    } catch (error) {
      push(error.response?.data?.message || "Could not run automation now", "error");
    } finally {
      setRunningNow(false);
    }
  }

  async function syncReplies() {
    setSyncingReplies(true);
    try {
      const response = await api.post("/gmail/sync-replies");
      push(`Reply sync complete: ${response.data.repliesFound || 0} replies found, ${response.data.leadsUpdated || 0} leads updated.`);
      await loadAutomation();
    } catch (error) {
      push(error.response?.data?.message || "Reply sync failed", "error");
    } finally {
      setSyncingReplies(false);
    }
  }

  async function toggleGlobalPause() {
    setTogglingPause(true);
    try {
      if (automationSettings?.automationPaused) {
        await api.post("/automation/resume");
        push("Automation resumed");
      } else {
        const reason = window.prompt("Pause reason (optional):", automationSettings?.automationPausedReason || "");
        await api.post("/automation/pause", reason ? { reason } : {});
        push("Automation paused");
      }
      await loadAutomation();
    } catch (error) {
      push(error.response?.data?.message || "Could not update automation pause state", "error");
    } finally {
      setTogglingPause(false);
    }
  }

  async function processLeadsNow() {
    setProcessingLeads(true);
    try {
      const response = await api.post("/automation/process-leads", {});
      push(`Lead automation complete: ${response.data.sent || 0} sent, ${response.data.processed || 0} processed, ${response.data.failed || 0} failed.`);
      await loadAutomation();
    } catch (error) {
      push(error.response?.data?.message || "Could not process leads", "error");
    } finally {
      setProcessingLeads(false);
    }
  }

  async function sendApprovedNow() {
    setSendingApproved(true);
    try {
      const response = await api.post("/automation/send-approved", {});
      push(`Approved send complete: ${response.data.sent || 0} sent, ${response.data.skipped || 0} skipped.`);
      await loadAutomation();
    } catch (error) {
      push(error.response?.data?.message || "Could not send approved emails", "error");
    } finally {
      setSendingApproved(false);
    }
  }

  async function processFollowUpsNow() {
    setProcessingFollowUps(true);
    try {
      const response = await api.post("/automation/process-follow-ups", {});
      const sent = response.data.sent ?? response.data.generated ?? 0;
      push(`Follow-up automation complete: ${sent} items handled.`);
      await loadAutomation();
    } catch (error) {
      push(error.response?.data?.message || "Could not process follow-ups", "error");
    } finally {
      setProcessingFollowUps(false);
    }
  }

  async function runScannerImportNow() {
    setRunningScannerImport(true);
    try {
      const response = await api.post("/automation/scanner-import", {});
      push(`Scanner import summary: ${response.data.imported || 0} imported, ${response.data.duplicates || 0} duplicates.`);
      await loadAutomation();
    } catch (error) {
      push(error.response?.data?.message || "Could not check scanner import automation", "error");
    } finally {
      setRunningScannerImport(false);
    }
  }

  function updateSetting(key, value) {
    setAutomationSettings((current) => ({ ...(current || {}), [key]: value }));
  }

  const sendUsage = dashboard.sendUsage || automationSettings?.sendUsage || {};
  const warnings = automationSettings?.warnings || dashboard.warnings || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">Automation</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Outreach automation</h1>
          <p className="mt-2 max-w-3xl text-slate-500">Control how scanner imports, qualification, report generation, email sending, reply sync, and follow-up prep run across the outreach pipeline.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={runScannerImportNow} disabled={runningScannerImport}>
            {runningScannerImport ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Scanner import
          </Button>
          <Button variant="secondary" onClick={processLeadsNow} disabled={processingLeads}>
            {processingLeads ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            Process leads
          </Button>
          <Button variant="secondary" onClick={sendApprovedNow} disabled={sendingApproved}>
            {sendingApproved ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
            Send approved
          </Button>
          <Button variant="secondary" onClick={processFollowUpsNow} disabled={processingFollowUps}>
            {processingFollowUps ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Process follow-ups
          </Button>
          <Button variant="secondary" onClick={syncReplies} disabled={syncingReplies}>
            {syncingReplies ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Sync replies
          </Button>
          <Button variant="secondary" onClick={toggleGlobalPause} disabled={togglingPause}>
            {automationSettings?.automationPaused ? <Play size={16} /> : <Pause size={16} />}
            {automationSettings?.automationPaused ? "Resume automation" : "Pause automation"}
          </Button>
          <Button onClick={runAutomationNow} disabled={runningNow}>
            {runningNow ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            Run automation now
          </Button>
          <Button variant="secondary" onClick={openCreate}><Plus size={16} /> New schedule</Button>
        </div>
      </div>

      {automationSettings?.automationPaused && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
            <Pause size={16} />
            Automation paused
          </div>
          <p className="mt-2 text-sm">{automationSettings.automationPausedReason || "Email sending and follow-up sending are paused globally."}</p>
        </div>
      )}

      {!!warnings.length && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-amber-900">
            <ShieldCheck size={16} />
            Safety warnings
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {warnings.map((warning) => (
              <Badge key={warning} className="bg-white text-amber-900 ring-amber-200">{warning}</Badge>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-8">
        {[
          ["Active schedules", dashboard.activeSchedules || 0],
          ["Runs today", dashboard.runsToday || 0],
          ["Success rate", `${dashboard.successRate || 0}%`],
          ["Avg runtime", `${dashboard.avgRuntime || 0} min`],
          ["Leads today", dashboard.leadsGeneratedToday || 0],
          ["Needs action", dashboard.needsActionCount || 0],
          ["Follow-ups due", dashboard.followUpsDueCount || 0],
          ["Replies detected", dashboard.repliedCount || 0]
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-4">
          <section className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold">Follow-up reminders</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {[
                  ["Due today", inbox.followUpReminders?.dueToday || 0],
                  ["Due tomorrow", inbox.followUpReminders?.dueTomorrow || 0],
                  ["Overdue", inbox.followUpReminders?.overdue || 0]
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                    <p className="mt-2 text-2xl font-semibold">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-2">
                {(inbox.followUpReminders?.items || []).slice(0, 6).map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold">{item.company}</p>
                      <Badge className="bg-slate-100 text-slate-700 ring-slate-200">{String(item.followUpStatus || "").toLowerCase().replaceAll("_", " ")}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{formatDate(item.nextFollowUpAt)}</p>
                  </div>
                ))}
                {!(inbox.followUpReminders?.items || []).length && <p className="text-sm text-slate-500">No follow-up reminders right now.</p>}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold">Needs action inbox</h2>
              <div className="mt-4 space-y-2">
                {(inbox.needsAction || []).slice(0, 8).map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold">{item.company}</p>
                      <Badge className="bg-amber-100 text-amber-800 ring-amber-200">{String(item.needsActionReason || "needs_action").replaceAll("_", " ")}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{item.lastReplySnippet || item.lastReplyFrom || formatDate(item.updatedAt)}</p>
                  </div>
                ))}
                {!(inbox.needsAction || []).length && <p className="text-sm text-slate-500">No leads need action right now.</p>}
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center gap-2">
              <Settings2 size={18} />
              <div>
                <h2 className="text-lg font-semibold">Automation settings</h2>
                <p className="text-sm text-slate-500">Phase 1 safety controls for mode, send limits, windows, and manual approval rules.</p>
              </div>
            </div>
            {automationSettings && (
              <form onSubmit={saveAutomationSettings} className="space-y-5">
                <div className="grid gap-4 lg:grid-cols-3">
                  <label>
                    <span className="mb-1.5 block text-sm font-medium">Automation mode</span>
                    <Select value={automationSettings.mode || "MANUAL_REVIEW"} onChange={(e) => updateSetting("mode", e.target.value)}>
                      <option value="MANUAL_REVIEW">Manual Review Mode</option>
                      <option value="SEMI_AUTOMATIC">Semi-Automatic Mode</option>
                      <option value="FULL_AUTOMATION">Full Automation Mode</option>
                    </Select>
                  </label>
                  <label>
                    <span className="mb-1.5 block text-sm font-medium">Send timezone</span>
                    <Input value={automationSettings.sendTimezone || "Asia/Singapore"} onChange={(e) => updateSetting("sendTimezone", e.target.value)} />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label>
                      <span className="mb-1.5 block text-sm font-medium">Start</span>
                      <Input type="time" value={automationSettings.sendWindowStart || "09:00"} onChange={(e) => updateSetting("sendWindowStart", e.target.value)} />
                    </label>
                    <label>
                      <span className="mb-1.5 block text-sm font-medium">End</span>
                      <Input type="time" value={automationSettings.sendWindowEnd || "18:00"} onChange={(e) => updateSetting("sendWindowEnd", e.target.value)} />
                    </label>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {[
                    ["scannerAutoImportEnabled", "Auto import scanner leads"],
                    ["autoAnalyzeLeadsEnabled", "Auto qualify leads"],
                    ["autoAnalyzeServicesEnabled", "Auto analyze services"],
                    ["autoRunPipelineEnabled", "Auto run outreach pipeline"],
                    ["autoGenerateReportsEnabled", "Auto generate reports"],
                    ["autoApproveReportsEnabled", "Auto approve reports"],
                    ["autoGenerateEmailsEnabled", "Auto generate emails"],
                    ["autoSendInitialEmailsEnabled", "Auto send initial emails"],
                    ["autoSyncRepliesEnabled", "Auto sync replies"],
                    ["autoGenerateFollowUpsEnabled", "Auto generate follow-ups"],
                    ["autoSendFollowUpsEnabled", "Auto send follow-ups"],
                    ["requireManualApprovalBeforeInitialSend", "Manual approval before initial send"],
                    ["requireManualApprovalBeforeFollowUpSend", "Manual approval before follow-up send"],
                    ["skipIfReportMissing", "Skip when report missing"],
                    ["skipIfRecipientMissing", "Skip when recipient missing"],
                    ["skipIfDuplicateDomain", "Skip duplicate domains"],
                    ["skipIfDuplicateEmail", "Skip duplicate emails"],
                    ["skipIfDoNotContact", "Skip do-not-contact"],
                    ["skipIfBounced", "Skip bounced leads"]
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={Boolean(automationSettings[key])}
                        onChange={(e) => updateSetting(key, e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  <label>
                    <span className="mb-1.5 block text-sm font-medium">Daily initial email limit</span>
                    <Input type="number" min="1" value={automationSettings.dailySendLimit || 30} onChange={(e) => updateSetting("dailySendLimit", e.target.value)} />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-sm font-medium">Hourly initial email limit</span>
                    <Input type="number" min="1" value={automationSettings.hourlySendLimit || 10} onChange={(e) => updateSetting("hourlySendLimit", e.target.value)} />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-sm font-medium">Batch size</span>
                    <Input type="number" min="1" value={automationSettings.batchSize || 10} onChange={(e) => updateSetting("batchSize", e.target.value)} />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-sm font-medium">Daily follow-up limit</span>
                    <Input type="number" min="1" value={automationSettings.dailyFollowUpLimit || 30} onChange={(e) => updateSetting("dailyFollowUpLimit", e.target.value)} />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-sm font-medium">Hourly follow-up limit</span>
                    <Input type="number" min="1" value={automationSettings.hourlyFollowUpLimit || 10} onChange={(e) => updateSetting("hourlyFollowUpLimit", e.target.value)} />
                  </label>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                    <p className="font-semibold text-slate-900">Send usage</p>
                    <p className="mt-2">Initial: {(sendUsage.initial?.today || 0)} today, {(sendUsage.initial?.thisHour || 0)} this hour</p>
                    <p className="mt-1">Follow-up: {(sendUsage.followUp?.today || 0)} today, {(sendUsage.followUp?.thisHour || 0)} this hour</p>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  <label>
                    <span className="mb-1.5 block text-sm font-medium">Minimum lead quality</span>
                    <Input type="number" min="0" max="10" value={automationSettings.minimumLeadQualityScore || 8} onChange={(e) => updateSetting("minimumLeadQualityScore", e.target.value)} />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-sm font-medium">Minimum report quality</span>
                    <Input type="number" min="0" max="10" value={automationSettings.minimumReportQualityScore || 8} onChange={(e) => updateSetting("minimumReportQualityScore", e.target.value)} />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-sm font-medium">Minimum email quality</span>
                    <Input type="number" min="0" max="10" value={automationSettings.minimumEmailQualityScore || 8} onChange={(e) => updateSetting("minimumEmailQualityScore", e.target.value)} />
                  </label>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <label>
                    <span className="mb-1.5 block text-sm font-medium">Allowed industries</span>
                    <textarea
                      rows={4}
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm shadow-sm outline-none ring-0 placeholder:text-slate-400 focus:border-slate-950"
                      value={Array.isArray(automationSettings.allowedIndustries) ? automationSettings.allowedIndustries.join(", ") : automationSettings.allowedIndustries || ""}
                      onChange={(e) => updateSetting("allowedIndustries", e.target.value)}
                      placeholder="Leave blank to allow all"
                    />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-sm font-medium">Blocked industries</span>
                    <textarea
                      rows={4}
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm shadow-sm outline-none ring-0 placeholder:text-slate-400 focus:border-slate-950"
                      value={Array.isArray(automationSettings.blockedIndustries) ? automationSettings.blockedIndustries.join(", ") : automationSettings.blockedIndustries || ""}
                      onChange={(e) => updateSetting("blockedIndustries", e.target.value)}
                      placeholder="Comma-separated industry names"
                    />
                  </label>
                </div>

                {automationSettings.mode === "FULL_AUTOMATION" && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    Full automation will send emails without manual review if leads pass safety gates. Make sure Gmail, send limits, do-not-contact rules, and quality thresholds are configured first.
                  </div>
                )}

                <div className="flex justify-end">
                  <Button disabled={savingSettings}>
                    {savingSettings ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    Save automation settings
                  </Button>
                </div>
              </form>
            )}
          </section>

          {schedules.map((schedule) => (
            <article key={schedule.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-xl font-semibold">{schedule.name}</h2>
                    <Badge className={schedule.enabled ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-700 ring-slate-200"}>
                      {schedule.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                    <Badge className="bg-indigo-50 text-indigo-700 ring-indigo-200">{schedule.frequency.toLowerCase()}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">{schedule.template?.name || "Missing template"} · {schedule.template?.keyword}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => runNow(schedule)}><Play size={16} /> Run now</Button>
                  <Button variant="secondary" onClick={() => pauseSchedule(schedule)}><Pause size={16} /> Pause</Button>
                  <Button variant="secondary" onClick={() => finishSchedule(schedule)}><SquareCheckBig size={16} /> Finish</Button>
                  <Button variant="secondary" onClick={() => toggleSchedule(schedule)}>{schedule.enabled ? "Disable" : "Enable"}</Button>
                  <Button variant="ghost" onClick={() => openEdit(schedule)}><Save size={16} /> Edit</Button>
                  <Button variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={() => deleteSchedule(schedule)}><Trash2 size={16} /></Button>
                </div>
              </div>
              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="flex items-center gap-2 text-sm font-semibold"><Activity size={16} /> Current run stage</p>
                  <Badge className={schedule.currentStage === "Scan failed" ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-slate-100 text-slate-700 ring-slate-200"}>{schedule.currentStage || "Scheduled"}</Badge>
                </div>
                <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-8">
                  {runStages.map((stage, index) => {
                    const current = stageIndex(schedule.currentStage);
                    const complete = current >= index;
                    return (
                      <div key={stage} className={`rounded-xl border p-3 text-xs ${complete ? "border-slate-950 bg-white text-slate-950" : "border-slate-200 bg-white/60 text-slate-400"}`}>
                        <CheckCircle2 size={14} className={complete ? "mb-2 text-emerald-600" : "mb-2"} />
                        {stage}
                      </div>
                    );
                  })}
                </div>
                {schedule.latestRun && <p className="mt-3 text-xs text-slate-500">Latest scan: {schedule.latestRun.status} · {schedule.latestRun.progress}% · {schedule.latestRun.results} results</p>}
                {schedule.latestRun && (
                  <div className="mt-4 space-y-3">
                    <div className="h-3 overflow-hidden rounded-full bg-white">
                      <div className="h-full rounded-full bg-slate-950 transition-all" style={{ width: `${schedule.latestRun.progressPercent || schedule.latestRun.progress || 0}%` }} />
                    </div>
                    <div className="grid gap-2 text-xs md:grid-cols-4">
                      <div className="rounded-xl bg-white p-3">
                        <p className="text-slate-400">Current URL</p>
                        <p className="mt-1 truncate font-semibold">{schedule.latestRun.currentUrl || "-"}</p>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <p className="text-slate-400">Completed</p>
                        <p className="mt-1 font-semibold">{schedule.latestRun.completedItems || 0} / {schedule.latestRun.totalItems || 0}</p>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <p className="text-slate-400">Failed</p>
                        <p className="mt-1 font-semibold">{schedule.latestRun.failedItems || 0}</p>
                      </div>
                      <div className="rounded-xl bg-white p-3">
                        <p className="text-slate-400">Progress</p>
                        <p className="mt-1 font-semibold">{schedule.latestRun.progressPercent || schedule.latestRun.progress || 0}%</p>
                      </div>
                    </div>
                    {schedule.latestRun.logs?.length > 0 && (
                      <div className="max-h-36 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-200">
                        {schedule.latestRun.logs.map((log, index) => <p key={index}>{log.message}</p>)}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Last run</p>
                  <p className="mt-2 text-sm font-semibold">{formatDate(schedule.lastRunAt)}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Next run</p>
                  <p className="mt-2 text-sm font-semibold">{formatDate(schedule.nextRunAt)}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Notifications</p>
                  <p className="mt-2 text-sm font-semibold">{schedule._count?.notifications || 0}</p>
                </div>
              </div>
            </article>
          ))}
          {!schedules.length && (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center">
              <CalendarClock className="mx-auto mb-4 text-slate-400" />
              <h3 className="text-lg font-semibold">No schedules yet</h3>
              <p className="mt-2 text-sm text-slate-500">Create a saved scanner template first, then schedule it to run daily or weekly.</p>
            </div>
          )}

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Automation performance by industry</h2>
            <div className="overflow-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    {["Schedule", "Industry", "Runs", "Leads found", "HOT leads", "Failures", "Est. pipeline"].map((header) => (
                      <th key={header} className="border-b border-slate-200 px-3 py-2">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {performance.map((row) => (
                    <tr key={row.scheduleId} className="border-b border-slate-100">
                      <td className="px-3 py-3 font-semibold">{row.scheduleName}</td>
                      <td className="px-3 py-3">{row.industry}</td>
                      <td className="px-3 py-3">{row.runs}</td>
                      <td className="px-3 py-3">{row.leadsFound}</td>
                      <td className="px-3 py-3">{row.hotLeads}</td>
                      <td className="px-3 py-3">{row.failures}</td>
                      <td className="px-3 py-3">{money(row.estimatedPipeline)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!performance.length && <p className="p-6 text-center text-sm text-slate-500">No automation performance yet.</p>}
            </div>
          </section>
        </section>

        <aside className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Recent automation jobs</h2>
            <div className="space-y-3">
              {jobs.map((job) => (
                <div key={job.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{job.scheduleName || job.type.replaceAll("_", " ")}</p>
                      <p className="text-xs uppercase tracking-wide text-slate-400">{job.stage || job.status}</p>
                    </div>
                    <Badge className={job.status === "completed" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-700 ring-slate-200"}>
                      {job.status}
                    </Badge>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-slate-950 transition-all" style={{ width: `${job.progressPercent || 0}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{job.completed} / {job.total} complete · {job.failed} failed</p>
                </div>
              ))}
              {!jobs.length && <p className="text-sm text-slate-500">No automation jobs yet.</p>}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Safety + limits</h2>
            <div className="grid gap-2">
              {[
                ["Mode", dashboard.automationMode || automationSettings?.mode || "MANUAL_REVIEW"],
                ["Pause state", automationSettings?.automationPaused ? "Paused" : "Running"],
                ["Reports generated", dashboard.reportsGenerated || 0],
                ["Reports approved", dashboard.reportsApproved || 0],
                ["Emails generated", dashboard.emailsGenerated || 0],
                ["Emails sent", dashboard.emailsSent || 0],
                ["Interested replies", dashboard.interestedReplies || 0],
                ["Follow-ups sent", dashboard.followUpsSent || 0],
                ["Initial sends left today", sendUsage.initial?.remainingToday ?? 0],
                ["Initial sends left this hour", sendUsage.initial?.remainingThisHour ?? 0],
                ["Follow-ups left today", sendUsage.followUp?.remainingToday ?? 0],
                ["Follow-ups left this hour", sendUsage.followUp?.remainingThisHour ?? 0],
                ["Bounced leads", dashboard.bouncedCount || 0],
                ["Do not contact", dashboard.doNotContactCount || 0]
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-sm">
                  <span>{label}</span>
                  <Badge className="bg-slate-100 text-slate-700 ring-slate-200">{value}</Badge>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Failure diagnostics</h2>
            <div className="grid gap-2">
              {[
                ["Cloudflare", diagnostics.cloudflare],
                ["Timeout", diagnostics.timeout],
                ["No website", diagnostics.noWebsite],
                ["OpenAI failed", diagnostics.openAiFailed],
                ["Screenshot failed", diagnostics.screenshotFailed],
                ["Google Places failed", diagnostics.googlePlacesFailed]
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-sm">
                  <span>{label}</span>
                  <Badge className={(value || 0) > 0 ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-slate-100 text-slate-700 ring-slate-200"}>{value || 0}</Badge>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold">Notification types</h2>
            <div className="flex flex-wrap gap-2">
              {(dashboard.notificationTypes || []).map((type) => <Badge key={type} className="bg-slate-100 text-slate-700 ring-slate-200">{type}</Badge>)}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Bell size={18} /> Notification center</h2>
            <div className="max-h-[520px] space-y-3 overflow-auto pr-1">
              {notifications.map((notification) => (
                <button key={notification.id} onClick={() => markRead(notification)} className={`w-full rounded-2xl border p-4 text-left ${notification.read ? "border-slate-200 bg-white" : "border-slate-950 bg-slate-50"}`}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="font-semibold">{notification.title}</p>
                    <Badge className={notification.type === "ERROR" ? "bg-rose-50 text-rose-700 ring-rose-200" : notification.type === "SUCCESS" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-700 ring-slate-200"}>{notification.type}</Badge>
                  </div>
                  <p className="text-sm leading-6 text-slate-600">{notification.message}</p>
                  <p className="mt-2 text-xs text-slate-400">{formatDate(notification.createdAt)}</p>
                </button>
              ))}
              {!notifications.length && <p className="text-sm text-slate-500">No automation notifications yet.</p>}
            </div>
          </section>
        </aside>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <form onSubmit={saveSchedule} className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-glow">
            <div className="mb-5">
              <h2 className="text-xl font-semibold tracking-tight">{editing ? "Edit schedule" : "Create schedule"}</h2>
              <p className="mt-1 text-sm text-slate-500">Choose a saved scanner template and run cadence.</p>
            </div>
            <div className="space-y-4">
              <label>
                <span className="mb-1.5 block text-sm font-medium">Name</span>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </label>
              <label>
                <span className="mb-1.5 block text-sm font-medium">Scanner template</span>
                <Select value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })} required>
                  <option value="">Select template</option>
                  {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                </Select>
              </label>
              <label>
                <span className="mb-1.5 block text-sm font-medium">Frequency</span>
                <Select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                  <option value="DAILY">Daily</option>
                  <option value="WEEKLY">Weekly</option>
                </Select>
              </label>
              <label>
                <span className="mb-1.5 block text-sm font-medium">Next run</span>
                <Input type="datetime-local" value={form.nextRunAt} onChange={(e) => setForm({ ...form, nextRunAt: e.target.value })} />
              </label>
              <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium">
                <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
                Enabled
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button disabled={saving}>{saving ? "Saving..." : "Save schedule"}</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
