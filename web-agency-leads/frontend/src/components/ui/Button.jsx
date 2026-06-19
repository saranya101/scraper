import clsx from "clsx";

export function Button({ className, variant = "primary", ...props }) {
  const variants = {
    primary: "bg-slate-950 text-white hover:bg-slate-800",
    secondary: "bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50",
    ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
    danger: "bg-rose-600 text-white hover:bg-rose-500"
  };
  return (
    <button
      className={clsx("inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60", variants[variant], className)}
      {...props}
    />
  );
}
