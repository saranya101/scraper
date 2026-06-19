import { BarChart3, DatabaseZap, LogOut, Menu, Radar, Search, Sparkles, UsersRound, X } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { initials } from "../utils/format.js";

const navItems = [
  { to: "/", label: "Leads", icon: BarChart3 },
  { to: "/scanner", label: "Scanner", icon: Radar },
  { to: "/imports", label: "Imports", icon: DatabaseZap }
];

export default function AppLayout() {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  const sidebar = (
    <aside className="flex h-full flex-col bg-[#080b12] p-4 text-white">
      <div className="flex items-center gap-3 px-2 py-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-white text-slate-950 shadow-glow">
          <Sparkles size={19} />
        </div>
        <div>
          <p className="text-sm font-semibold">Agency Leads</p>
          <p className="text-xs text-slate-400">Private redesign CRM</p>
        </div>
      </div>
      <nav className="mt-8 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                isActive ? "bg-white text-slate-950" : "text-slate-400 hover:bg-white/10 hover:text-white"
              }`
            }
          >
            <item.icon size={17} />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto rounded-2xl border border-white/10 bg-white/[0.04] p-3">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-xs font-bold">{initials(user?.name)}</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{user?.name}</p>
            <p className="truncate text-xs text-slate-400">{user?.email}</p>
          </div>
        </div>
        <Button onClick={handleLogout} variant="ghost" className="mt-3 w-full justify-start text-slate-300 hover:bg-white/10 hover:text-white">
          <LogOut size={16} /> Logout
        </Button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <div className="fixed inset-y-0 left-0 z-30 hidden w-72 lg:block">{sidebar}</div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-slate-950/50" onClick={() => setOpen(false)} aria-label="Close menu" />
          <div className="relative h-full w-72">{sidebar}</div>
        </div>
      )}
      <main className="lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-slate-50/85 px-4 py-3 backdrop-blur md:px-8">
          <div className="flex items-center gap-3">
            <button className="rounded-lg p-2 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu size={20} />
            </button>
            <div className="hidden h-10 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-400 shadow-sm md:flex">
              <Search size={16} />
              Search companies, industries, locations, websites
            </div>
            <div className="ml-auto flex items-center gap-3 rounded-full bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-slate-200">
              <UsersRound size={16} className="text-slate-400" />
              <span className="hidden font-medium sm:inline">Admin workspace</span>
            </div>
            {open && (
              <button className="rounded-lg p-2 hover:bg-slate-100" onClick={() => setOpen(false)} aria-label="Close menu">
                <X size={20} />
              </button>
            )}
          </div>
        </header>
        <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
