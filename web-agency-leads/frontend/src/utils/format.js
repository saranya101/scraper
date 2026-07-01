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

export const pipelineStages = {
  NOT_CONTACTED: { label: "Not Contacted", className: "bg-slate-100 text-slate-700 ring-slate-200" },
  DRAFTED: { label: "Drafted", className: "bg-violet-50 text-violet-700 ring-violet-200" },
  SENT: { label: "Sent", className: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  REPLIED: { label: "Replied", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  BOUNCED: { label: "Bounced", className: "bg-rose-50 text-rose-700 ring-rose-200" },
  MEETING: { label: "Meeting", className: "bg-cyan-50 text-cyan-700 ring-cyan-200" },
  PROPOSAL: { label: "Proposal", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  WON: { label: "Won", className: "bg-green-50 text-green-700 ring-green-200" },
  LOST: { label: "Lost", className: "bg-rose-50 text-rose-700 ring-rose-200" }
};

export const pipelineStageOrder = ["NOT_CONTACTED", "DRAFTED", "SENT", "REPLIED", "BOUNCED", "MEETING", "PROPOSAL", "WON", "LOST"];

export const websiteStatuses = {
  WORKING: { label: "Working", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  CLOUDFLARE: { label: "Cloudflare", className: "bg-orange-50 text-orange-700 ring-orange-200" },
  CAPTCHA: { label: "CAPTCHA", className: "bg-orange-50 text-orange-700 ring-orange-200" },
  FORBIDDEN: { label: "403 Forbidden", className: "bg-rose-50 text-rose-700 ring-rose-200" },
  NOT_FOUND: { label: "404 Not Found", className: "bg-rose-50 text-rose-700 ring-rose-200" },
  SERVER_ERROR: { label: "500 Server Error", className: "bg-rose-50 text-rose-700 ring-rose-200" },
  SSL_ERROR: { label: "SSL Error", className: "bg-rose-50 text-rose-700 ring-rose-200" },
  TIMEOUT: { label: "Timeout", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  REDIRECT_LOOP: { label: "Redirect Loop", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  DOMAIN_PARKED: { label: "Domain Parked", className: "bg-zinc-100 text-zinc-700 ring-zinc-200" },
  WEBSITE_OFFLINE: { label: "Offline", className: "bg-rose-50 text-rose-700 ring-rose-200" },
  NO_WEBSITE: { label: "No Website", className: "bg-slate-100 text-slate-700 ring-slate-200" },
  BOT_PROTECTION: { label: "Bot Protection", className: "bg-orange-50 text-orange-700 ring-orange-200" },
  UNKNOWN: { label: "Unknown", className: "bg-slate-100 text-slate-700 ring-slate-200" }
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
