import { Bell, CalendarClock, Play, Plus, Save, Trash2 } from "lucide-react";
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
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  async function loadAutomation() {
    const [schedulesRes, templatesRes, notificationsRes] = await Promise.all([
      api.get("/automation/schedules"),
      api.get("/scanner/templates"),
      api.get("/automation/notifications")
    ]);
    setSchedules(schedulesRes.data);
    setTemplates(templatesRes.data);
    setNotifications(notificationsRes.data);
  }

  useEffect(() => {
    loadAutomation().catch(() => push("Could not load automation", "error"));
  }, []);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">Automation</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Scheduled scans</h1>
          <p className="mt-2 max-w-2xl text-slate-500">Run saved scanner templates automatically and let results flow into Scanner, Leads, CRM, and Outreach.</p>
        </div>
        <Button onClick={openCreate}><Plus size={16} /> New schedule</Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-4">
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
                  <Button variant="secondary" onClick={() => toggleSchedule(schedule)}>{schedule.enabled ? "Disable" : "Enable"}</Button>
                  <Button variant="ghost" onClick={() => openEdit(schedule)}><Save size={16} /> Edit</Button>
                  <Button variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={() => deleteSchedule(schedule)}><Trash2 size={16} /></Button>
                </div>
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
        </section>

        <aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Bell size={18} /> Notification center</h2>
          <div className="max-h-[720px] space-y-3 overflow-auto pr-1">
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
