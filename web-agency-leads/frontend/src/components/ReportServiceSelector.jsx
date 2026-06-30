import { REPORT_SERVICE_OPTIONS } from "../constants/reportServices.js";

export default function ReportServiceSelector({ value = [], onChange, label = "Services to include in PDF report" }) {
  function toggle(id) {
    const next = value.includes(id) ? value.filter((item) => item !== id) : [...value, id];
    onChange(next);
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">{label}</p>
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
