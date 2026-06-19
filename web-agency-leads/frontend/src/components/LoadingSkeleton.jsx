export function LoadingSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="h-56 animate-pulse rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4 h-4 w-1/2 rounded bg-slate-100" />
          <div className="mb-2 h-8 w-3/4 rounded bg-slate-100" />
          <div className="h-4 w-full rounded bg-slate-100" />
          <div className="mt-10 h-20 rounded-xl bg-slate-100" />
        </div>
      ))}
    </div>
  );
}
