import { Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { REPORT_SERVICE_OPTIONS } from "../constants/reportServices.js";
import { analyzeCompatibleReportServices } from "../utils/reportServiceCompatibility.js";
import { Badge } from "./ui/Badge.jsx";
import { Button } from "./ui/Button.jsx";

export default function ReportServiceSelector({ value = [], onChange, label = "Services to include in PDF report", analysisTarget = null }) {
  const [analysis, setAnalysis] = useState(null);

  useEffect(() => {
    setAnalysis(null);
  }, [analysisTarget?.id, analysisTarget?.company, analysisTarget?.industry, analysisTarget?.industryRef?.name]);

  function toggle(id) {
    const next = value.includes(id) ? value.filter((item) => item !== id) : [...value, id];
    onChange(next);
  }

  function analyzeServices() {
    if (!analysisTarget) return;
    const next = analyzeCompatibleReportServices(analysisTarget);
    setAnalysis(next);
    if (next.selectedIds.length) onChange(next.selectedIds);
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</p>
        {analysisTarget ? (
          <Button type="button" variant="secondary" className="rounded-full px-3 py-1.5 text-xs" onClick={analyzeServices}>
            <Wand2 size={14} />
            Analyze services
          </Button>
        ) : null}
      </div>
      {analysis ? (
        <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Compatible services for {analysis.company}</p>
          <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{analysis.summary}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {analysis.selectedIds.map((serviceId) => (
              <Badge key={serviceId} className="bg-slate-900 text-white ring-slate-900 dark:bg-white dark:text-slate-950 dark:ring-white">
                {REPORT_SERVICE_OPTIONS.find((service) => service.id === serviceId)?.label || serviceId}
              </Badge>
            ))}
          </div>
          <div className="mt-4 space-y-2">
            {analysis.matches.slice(0, 4).map((match) => (
              <div key={match.id} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{match.label}</p>
                  <Badge className="bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700">
                    Fit score {match.score}
                  </Badge>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{match.reasons[0] || "Suggested from business type and available service signals."}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="grid gap-2 md:grid-cols-2">
        {REPORT_SERVICE_OPTIONS.map((service) => {
          const active = value.includes(service.id);
          return (
            <label
              key={service.id}
              className={`cursor-pointer rounded-2xl border p-3 transition ${
                active
                  ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-950"
                  : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={active}
                  onChange={() => toggle(service.id)}
                />
                <div>
                  <p className="font-semibold">{service.label}</p>
                  <p className={`mt-1 text-sm leading-5 ${active ? "text-white/80 dark:text-slate-700" : "text-slate-500 dark:text-slate-400"}`}>{service.description}</p>
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
