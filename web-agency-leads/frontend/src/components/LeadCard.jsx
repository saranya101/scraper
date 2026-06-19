import { ArrowUpRight, Building2, MapPin, MoreHorizontal } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "./ui/Badge.jsx";
import { Button } from "./ui/Button.jsx";
import { domain, formatDate, priorities, statuses } from "../utils/format.js";

export default function LeadCard({ lead, onEdit, onArchive }) {
  return (
    <article className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-soft">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to={`/leads/${lead.id}`} className="block truncate text-lg font-semibold tracking-tight hover:text-slate-700">
            {lead.company}
          </Link>
          <a href={lead.website} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-950">
            {domain(lead.website)} <ArrowUpRight size={13} />
          </a>
        </div>
        <Badge className={priorities[lead.priority]?.className}>{priorities[lead.priority]?.label}</Badge>
      </div>
      <div className="mb-5 rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">AI score</p>
            <p className="mt-1 text-4xl font-semibold tracking-tight">{lead.score}<span className="text-lg text-slate-400">/10</span></p>
          </div>
          <Badge className={statuses[lead.status]?.className}>{statuses[lead.status]?.label}</Badge>
        </div>
      </div>
      <div className="space-y-2 text-sm text-slate-500">
        <p className="flex items-center gap-2"><Building2 size={15} /> {lead.industry || "Uncategorized"}</p>
        <p className="flex items-center gap-2 truncate"><MapPin size={15} /> {lead.address || "No location saved"}</p>
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
        <p className="text-xs text-slate-400">Updated {formatDate(lead.updatedAt)}</p>
        <div className="flex gap-2">
          <Button variant="ghost" className="px-2.5" onClick={() => onEdit(lead)}><MoreHorizontal size={16} /></Button>
          <Button variant="secondary" onClick={() => onArchive(lead)}>Archive</Button>
        </div>
      </div>
    </article>
  );
}
