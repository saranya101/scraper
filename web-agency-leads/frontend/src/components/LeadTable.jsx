import { ArrowUpRight, Pencil, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "./ui/Badge.jsx";
import { Button } from "./ui/Button.jsx";
import { domain, priorities, statuses } from "../utils/format.js";

export default function LeadTable({ leads, onEdit, onDelete }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Industry</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {leads.map((lead) => (
              <tr key={lead.id} className="hover:bg-slate-50/80">
                <td className="px-4 py-3">
                  <Link to={`/leads/${lead.id}`} className="font-semibold text-slate-950 hover:underline">{lead.company}</Link>
                  <a href={lead.website} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                    {domain(lead.website)} <ArrowUpRight size={12} />
                  </a>
                </td>
                <td className="px-4 py-3 text-slate-600">{lead.industry || "-"}</td>
                <td className="px-4 py-3 font-semibold">{lead.score}/10</td>
                <td className="px-4 py-3"><Badge className={priorities[lead.priority]?.className}>{priorities[lead.priority]?.label}</Badge></td>
                <td className="px-4 py-3"><Badge className={statuses[lead.status]?.className}>{statuses[lead.status]?.label}</Badge></td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" className="px-2.5" onClick={() => onEdit(lead)}><Pencil size={15} /></Button>
                    <Button variant="ghost" className="px-2.5 text-rose-600 hover:bg-rose-50" onClick={() => onDelete(lead)}><Trash2 size={15} /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
