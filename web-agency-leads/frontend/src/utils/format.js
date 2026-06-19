export const priorities = {
  HOT: { label: "Hot", className: "bg-rose-50 text-rose-700 ring-rose-200" },
  WARM: { label: "Warm", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  COLD: { label: "Cold", className: "bg-sky-50 text-sky-700 ring-sky-200" }
};

export const statuses = {
  NOT_CONTACTED: { label: "Not Contacted", className: "bg-slate-100 text-slate-700 ring-slate-200" },
  CONTACTED: { label: "Contacted", className: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  REPLIED: { label: "Replied", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  CLOSED: { label: "Closed", className: "bg-zinc-100 text-zinc-700 ring-zinc-200" },
  ARCHIVED: { label: "Archived", className: "bg-neutral-100 text-neutral-500 ring-neutral-200" }
};

export function formatDate(value) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Never";
}

export function initials(name = "") {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function domain(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
