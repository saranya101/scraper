import { BarChart3, ChartNoAxesCombined, Clock3, DatabaseZap, KanbanSquare, Layers3, LogOut, MailPlus, Menu, Moon, PanelLeftClose, PanelLeftOpen, Plug, Radar, Search, Settings, Sparkles, Sun, UsersRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { api } from "../services/api.js";
import { initials } from "../utils/format.js";
import { workspaceNav } from "../utils/workspaces.js";

const navItems = [
  { to: "/", label: "All Leads", icon: BarChart3 },
  { to: "/crm", label: "CRM Pipeline", icon: KanbanSquare },
  { to: "/outreach", label: "Outreach Pipeline", icon: MailPlus },
  { to: "/analytics", label: "Analytics", icon: ChartNoAxesCombined },
  { to: "/automation", label: "Automation", icon: Clock3 },
  { to: "/workspaces", label: "Workspaces", icon: Layers3 },
  { to: "/scanner", label: "Scanner", icon: Radar },
  { to: "/imports", label: "Imports", icon: DatabaseZap },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/settings/email", label: "Email Settings", icon: Plug }
];

export default function AppLayout() {
  const [open, setOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("theme") === "dark");
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebarCollapsed") === "true");
  const [industries, setIndustries] = useState(workspaceNav.map((item) => ({ slug: item.slug, name: item.label })));
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    localStorage.setItem("sidebarCollapsed", collapsed ? "true" : "false");
  }, [collapsed]);

  useEffect(() => {
    api.get("/leads/meta/catalog")
      .then(({ data }) => setIndustries((data.industries || []).map((item) => ({ slug: item.slug, name: item.name }))))
      .catch(() => {});
  }, []);

  const sidebar = (forceExpanded = false) => {
    const compact = collapsed && !forceExpanded;
    return (
    <aside className={`flex h-full min-h-0 flex-col bg-[#080b12] text-white transition-all duration-200 ${compact ? "p-3" : "p-4"}`}>
      <div className={`flex shrink-0 items-center gap-3 py-3 ${compact ? "justify-center px-0" : "px-2"}`}>
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-white text-slate-950 shadow-glow">
          <Sparkles size={19} />
        </div>
        {!compact && <div className="min-w-0">
          <p className="text-sm font-semibold">Agency Leads</p>
          <p className="text-xs text-slate-400">Private redesign CRM</p>
        </div>}
      </div>
      {!forceExpanded && (
        <button
          className={`mt-2 hidden items-center rounded-xl px-3 py-2 text-sm text-slate-400 transition hover:bg-white/10 hover:text-white lg:flex ${compact ? "justify-center" : "gap-3"}`}
          onClick={() => setCollapsed((value) => !value)}
          title={compact ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
        >
          {compact ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          {!compact && <span>Collapse</span>}
        </button>
      )}
      <div className="mt-6 min-h-0 flex-1 overflow-y-auto pr-1">
        <nav className="space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center rounded-xl px-3 py-2.5 text-sm font-medium transition ${compact ? "justify-center" : "gap-3"} ${
                  isActive ? "bg-white text-slate-950" : "text-slate-400 hover:bg-white/10 hover:text-white"
                }`
              }
              title={compact ? item.label : undefined}
            >
              <item.icon size={18} className="shrink-0" />
              {!compact && <span className="truncate">{item.label}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="mt-7">
          {!compact && <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Industries</p>}
          <nav className="mt-3 space-y-1">
            {industries.map((item) => (
              <NavLink
                key={item.slug}
                to={`/workspaces/${item.slug}`}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex items-center rounded-xl px-3 py-2 text-sm font-medium transition ${compact ? "justify-center" : "gap-2"} ${
                    isActive ? "bg-white text-slate-950" : "text-slate-400 hover:bg-white/10 hover:text-white"
                  }`
                }
                title={compact ? item.name || item.label : undefined}
              >
                {compact ? <span className="grid h-5 w-5 place-items-center rounded-full bg-white/10 text-[10px] font-bold">{(item.name || item.label || "?").slice(0, 1)}</span> : <span className="truncate">{item.name || item.label}</span>}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>
      <div className={`mt-4 shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] ${compact ? "p-2" : "p-3"}`}>
        <div className={`flex items-center ${compact ? "justify-center" : "gap-3"}`}>
          <div className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-xs font-bold">{initials(user?.name)}</div>
          {!compact && <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{user?.name}</p>
            <p className="truncate text-xs text-slate-400">{user?.email}</p>
          </div>}
        </div>
        <Button onClick={handleLogout} variant="ghost" className={`mt-3 w-full text-slate-300 hover:bg-white/10 hover:text-white ${compact ? "justify-center px-2" : "justify-start"}`} title={compact ? "Logout" : undefined}>
          <LogOut size={16} /> {!compact && "Logout"}
        </Button>
      </div>
    </aside>
  );
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50 text-slate-950 transition-colors dark:bg-slate-950 dark:text-slate-50">
      <div className={`fixed inset-y-0 left-0 z-30 hidden transition-all duration-200 lg:block ${collapsed ? "w-20" : "w-72"}`}>{sidebar(false)}</div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-slate-950/50" onClick={() => setOpen(false)} aria-label="Close menu" />
          <div className="relative h-full w-[min(18rem,calc(100vw-2rem))] shadow-2xl">{sidebar(true)}</div>
        </div>
      )}
      <main className={`min-w-0 transition-[padding] duration-200 ${collapsed ? "lg:pl-20" : "lg:pl-72"}`}>
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-slate-50/85 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu size={20} />
            </button>
            <div className="hidden h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-400 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:flex">
              <Search size={16} />
              <span className="truncate">Search companies, industries, locations, websites</span>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-3 rounded-full bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
              <UsersRound size={16} className="text-slate-400" />
              <span className="hidden font-medium sm:inline">Admin workspace</span>
            </div>
            <button
              className="rounded-full bg-white p-2 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-100 dark:bg-slate-900 dark:ring-slate-700 dark:hover:bg-slate-800"
              onClick={() => setDarkMode((value) => !value)}
              aria-label="Toggle dark mode"
            >
              {darkMode ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            {open && (
              <button className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setOpen(false)} aria-label="Close menu">
                <X size={20} />
              </button>
            )}
          </div>
        </header>
        <div className="mx-auto min-w-0 max-w-[1600px] overflow-x-hidden px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
