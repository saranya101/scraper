import { BarChart3, Filter, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "../components/ui/Badge.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Input, Select } from "../components/ui/Input.jsx";
import { useToast } from "../hooks/useToast.jsx";
import { api } from "../services/api.js";

const metricCards = [
  ["scansRun", "Scans run"],
  ["leadsFound", "Leads found"],
  ["hotLeadPercentage", "HOT %", "%"],
  ["contactedPercentage", "Contacted %", "%"],
  ["repliedPercentage", "Replied %", "%"],
  ["wonPercentage", "Won %", "%"],
  ["estimatedPipelineValue", "Est. pipeline", "$"],
  ["averageOpportunityScore", "Avg opportunity"]
];

function todayMinus(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function formatValue(value, prefixOrSuffix) {
  if (prefixOrSuffix === "$") return `$${Number(value || 0).toLocaleString()}`;
  if (prefixOrSuffix === "%") return `${value || 0}%`;
  return value ?? 0;
}

function BarList({ items, labelKey, valueKey = "total", tone = "slate" }) {
  const max = Math.max(...items.map((item) => Number(item[valueKey] || 0)), 1);
  const color = tone === "green" ? "bg-emerald-500" : tone === "rose" ? "bg-rose-500" : "bg-slate-950";
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item[labelKey]} className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="truncate text-sm font-semibold">{item[labelKey]}</p>
            <span className="text-sm text-slate-500">{item[valueKey] || 0}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max((Number(item[valueKey] || 0) / max) * 100, 4)}%` }} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge className="bg-rose-50 text-rose-700 ring-rose-200">{item.hotPercentage || 0}% HOT</Badge>
            <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200">{item.repliedPercentage || 0}% replied</Badge>
            <Badge className="bg-slate-100 text-slate-700 ring-slate-200">Opp {item.averageOpportunityScore || 0}</Badge>
          </div>
        </div>
      ))}
      {!items.length && <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No data for this view.</p>}
    </div>
  );
}

export default function AnalyticsPage() {
  const { push } = useToast();
  const [catalog, setCatalog] = useState({ industries: [], services: [] });
  const [overview, setOverview] = useState({});
  const [industries, setIndustries] = useState({ items: [], best: [], worst: [] });
  const [services, setServices] = useState({ items: [] });
  const [locations, setLocations] = useState({ items: [] });
  const [funnel, setFunnel] = useState([]);
  const [filters, setFilters] = useState({ startDate: todayMinus(30), endDate: new Date().toISOString().slice(0, 10), industry: "", serviceId: "", location: "" });
  const [loading, setLoading] = useState(true);

  const params = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), [filters]);

  async function loadAnalytics() {
    setLoading(true);
    try {
      const [overviewRes, industriesRes, servicesRes, locationsRes, funnelRes] = await Promise.all([
        api.get("/analytics/overview", { params }),
        api.get("/analytics/industries", { params }),
        api.get("/analytics/services", { params }),
        api.get("/analytics/locations", { params }),
        api.get("/analytics/funnel", { params })
      ]);
      setOverview(overviewRes.data);
      setIndustries(industriesRes.data);
      setServices(servicesRes.data);
      setLocations(locationsRes.data);
      setFunnel(funnelRes.data);
    } catch (error) {
      push(error.response?.data?.message || "Could not load analytics", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api.get("/leads/meta/catalog").then(({ data }) => setCatalog(data)).catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(loadAnalytics, 200);
    return () => clearTimeout(timer);
  }, [JSON.stringify(params)]);

  const funnelMax = Math.max(...funnel.map((item) => item.count), 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">Analytics</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">What is working</h1>
          <p className="mt-2 max-w-2xl text-slate-500">Track which scans, niches, services, and locations are creating the strongest pipeline.</p>
        </div>
        <Button variant="secondary" onClick={loadAnalytics}><BarChart3 size={16} /> Refresh</Button>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-600"><Filter size={16} /> Filters</div>
        <div className="grid gap-3 md:grid-cols-5">
          <Input type="date" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })} />
          <Input type="date" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })} />
          <Select value={filters.industry} onChange={(e) => setFilters({ ...filters, industry: e.target.value })}>
            <option value="">All industries</option>
            {catalog.industries.map((industry) => <option key={industry.id} value={industry.name}>{industry.name}</option>)}
          </Select>
          <Select value={filters.serviceId} onChange={(e) => setFilters({ ...filters, serviceId: e.target.value })}>
            <option value="">All services</option>
            {catalog.services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
          </Select>
          <Input value={filters.location} onChange={(e) => setFilters({ ...filters, location: e.target.value })} placeholder="Location" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metricCards.map(([key, label, symbol]) => (
          <div key={key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight">{formatValue(overview[key], symbol)}</p>
          </div>
        ))}
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-5 text-lg font-semibold">Pipeline funnel</h2>
        <div className="grid gap-3 md:grid-cols-7">
          {funnel.map((stage) => (
            <div key={stage.key} className="rounded-2xl bg-slate-50 p-4">
              <p className="text-sm font-semibold">{stage.label}</p>
              <p className="mt-2 text-2xl font-semibold">{stage.count}</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                <div className="h-full rounded-full bg-slate-950" style={{ width: `${Math.max((stage.count / funnelMax) * 100, 4)}%` }} />
              </div>
              <p className="mt-2 text-xs text-slate-400">{stage.percentage}% of leads</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Charts by industry</h2>
          <BarList items={industries.items} labelKey="industry" />
        </section>
        <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Charts by service</h2>
          <BarList items={services.items} labelKey="service" valueKey="estimatedPipelineValue" tone="green" />
        </section>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Charts by location</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <BarList items={locations.items.slice(0, 9)} labelKey="location" />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-emerald-950"><TrendingUp size={18} /> Best performing niches</h2>
          <BarList items={industries.best} labelKey="industry" tone="green" />
        </section>
        <section className="rounded-3xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-rose-950"><TrendingDown size={18} /> Worst performing niches</h2>
          <BarList items={industries.worst} labelKey="industry" tone="rose" />
        </section>
      </div>

      {loading && <p className="text-sm text-slate-500">Refreshing analytics...</p>}
    </div>
  );
}
