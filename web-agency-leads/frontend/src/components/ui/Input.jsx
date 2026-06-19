import clsx from "clsx";

export function Input({ className, ...props }) {
  return <input className={clsx("h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-100", className)} {...props} />;
}

export function Textarea({ className, ...props }) {
  return <textarea className={clsx("min-h-28 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-100", className)} {...props} />;
}

export function Select({ className, ...props }) {
  return <select className={clsx("h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100", className)} {...props} />;
}
