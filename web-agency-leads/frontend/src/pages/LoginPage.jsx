import { ArrowRight, LockKeyhole, Sparkles } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button.jsx";
import { Input } from "../components/ui/Input.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useToast } from "../hooks/useToast.jsx";

export default function LoginPage() {
  const { user, login } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    try {
      await login(form.email, form.password);
      navigate("/");
    } catch (error) {
      push(error.response?.data?.message || "Login failed", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-[#080b12] text-white lg:grid-cols-[1.1fr_0.9fr]">
      <section className="relative hidden overflow-hidden p-12 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.16),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(56,189,248,0.20),transparent_30%)]" />
        <div className="relative flex h-full flex-col justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-slate-950">
              <Sparkles size={21} />
            </div>
            <span className="text-sm font-semibold text-slate-200">Agency Leads</span>
          </div>
          <div className="max-w-xl">
            <p className="mb-4 inline-flex rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-slate-300">Private acquisition command center</p>
            <h1 className="text-5xl font-semibold tracking-tight">Find redesign opportunities before everyone else does.</h1>
            <p className="mt-5 text-lg leading-8 text-slate-300">Score weak websites, organize outreach, track replies, and keep the two-founder sales engine sharp.</p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm text-slate-300">
            {["JWT protected", "Neon Postgres", "Audit-first workflow"].map((item) => (
              <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">{item}</div>
            ))}
          </div>
        </div>
      </section>
      <section className="grid place-items-center bg-slate-50 px-5 py-10 text-slate-950">
        <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-glow">
          <div className="mb-8">
            <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-slate-950 text-white">
              <LockKeyhole size={20} />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
            <p className="mt-2 text-sm text-slate-500">Sign in with one of the seeded admin accounts.</p>
          </div>
          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Email</span>
            <Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
          </label>
          <label className="mb-6 block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Password</span>
            <Input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
          </label>
          <Button className="w-full" disabled={loading}>
            {loading ? "Signing in..." : "Open dashboard"} <ArrowRight size={16} />
          </Button>
        </form>
      </section>
    </div>
  );
}
