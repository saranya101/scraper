import clsx from "clsx";

export function Input({ className, ...props }) {
  return <input className={clsx("h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600 dark:focus:ring-slate-800/70", className)} {...props} />;
}

export function Textarea({ className, ...props }) {
  return <textarea className={clsx("min-h-28 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600 dark:focus:ring-slate-800/70", className)} {...props} />;
}

export function Select({ className, ...props }) {
  return <select className={clsx("h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-600 dark:focus:ring-slate-800/70", className)} {...props} />;
}
