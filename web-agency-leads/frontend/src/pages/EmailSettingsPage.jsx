import { MailCheck, Plug, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "../components/ui/Badge.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Input } from "../components/ui/Input.jsx";
import { useToast } from "../hooks/useToast.jsx";
import { api } from "../services/api.js";
import { formatDate } from "../utils/format.js";

export default function EmailSettingsPage() {
  const { push } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [emailSending, setEmailSending] = useState({ dailySendLimit: 25, cooldownDays: 14 });
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [accountsRes, settingsRes] = await Promise.all([
        api.get("/email/accounts"),
        api.get("/settings")
      ]);
      setAccounts(accountsRes.data);
      setEmailSending(settingsRes.data.emailSending || { dailySendLimit: 25, cooldownDays: 14 });
    } catch (error) {
      push(error.response?.data?.message || "Could not load email settings", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const email = params.get("email");
    if (connected && email) {
      push(`${connected} connected: ${email}`);
      window.history.replaceState({}, "", "/settings/email");
    }
    load();
  }, []);

  async function connect(provider) {
    try {
      const { data } = await api.post(`/email/connect/${provider}`);
      window.location.href = data.authUrl;
    } catch (error) {
      push(error.response?.data?.message || "Could not start OAuth connection", "error");
    }
  }

  async function disconnect(account) {
    if (!confirm(`Disconnect ${account.email}?`)) return;
    await api.post(`/email/disconnect/${account.id}`);
    push("Email account disconnected");
    await load();
  }

  async function saveLimit() {
    const { data } = await api.put("/settings/app", { emailSending });
    setEmailSending(data.emailSending || emailSending);
    push("Daily send limit saved");
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">Connectors</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Email Settings</h1>
        <p className="mt-2 max-w-2xl text-slate-500">Connect Gmail or Outlook, keep tokens encrypted on the backend, and control daily outreach volume.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-white"><Plug size={19} /></div>
            <div>
              <h2 className="text-lg font-semibold">Connect email</h2>
              <p className="text-sm text-slate-500">OAuth only. Passwords are never requested.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => connect("google")}>Connect Gmail</Button>
            <Button variant="secondary" onClick={() => connect("microsoft")}>Connect Outlook</Button>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-white"><ShieldCheck size={19} /></div>
            <div>
              <h2 className="text-lg font-semibold">Safety limits</h2>
              <p className="text-sm text-slate-500">This blocks accidental high-volume sends.</p>
            </div>
          </div>
          <label>
            <span className="mb-1.5 block text-sm font-medium">Daily send limit</span>
            <Input type="number" min="1" max="500" value={emailSending.dailySendLimit || 25} onChange={(e) => setEmailSending({ ...emailSending, dailySendLimit: e.target.value })} />
          </label>
          <label className="mt-3 block">
            <span className="mb-1.5 block text-sm font-medium">Lead cooldown days</span>
            <Input type="number" min="1" max="90" value={emailSending.cooldownDays || 14} onChange={(e) => setEmailSending({ ...emailSending, cooldownDays: e.target.value })} />
          </label>
          <Button className="mt-4" variant="secondary" onClick={saveLimit}>Save limit</Button>
        </section>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold"><MailCheck size={18} /> Connected accounts</h2>
            <p className="mt-1 text-sm text-slate-500">Tokens are hidden from the frontend.</p>
          </div>
          <Badge className="bg-slate-100 text-slate-700 ring-slate-200">{accounts.length} connected</Badge>
        </div>
        <div className="space-y-3">
          {accounts.map((account) => (
            <div key={account.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-semibold">{account.email}</p>
                <p className="mt-1 text-sm text-slate-500">{account.provider} · Connected {formatDate(account.connectedAt)}</p>
              </div>
              <Button variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={() => disconnect(account)}><Trash2 size={16} /> Disconnect</Button>
            </div>
          ))}
          {!accounts.length && !loading && <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No email account connected yet.</p>}
        </div>
      </section>
    </div>
  );
}
