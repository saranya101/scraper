import { Expand, X } from "lucide-react";
import { useState } from "react";
import clsx from "clsx";

const variants = {
  scroll: {
    container: "max-h-[420px] overflow-auto",
    image: "h-auto w-full max-w-full"
  },
  contain: {
    container: "h-[320px] sm:h-[420px] overflow-hidden",
    image: "h-full w-full max-w-full object-contain"
  },
  card: {
    container: "h-[220px] overflow-hidden",
    image: "h-full w-full max-w-full object-cover"
  },
  compact: {
    container: "h-40 overflow-hidden",
    image: "h-full w-full max-w-full object-cover"
  }
};

export default function ScreenshotPreview({ src, alt, variant = "card", className, imageClassName }) {
  const [open, setOpen] = useState(false);
  if (!src) return null;
  const styles = variants[variant] || variants.card;

  return (
    <>
      <div className={clsx("group relative min-w-0 max-w-full rounded-xl bg-slate-100", styles.container, className)}>
        <img src={src} alt={alt} className={clsx("block", styles.image, imageClassName)} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-lg bg-slate-950/85 text-white opacity-100 shadow-sm transition hover:bg-slate-950 sm:opacity-0 sm:group-hover:opacity-100"
          aria-label={`Open ${alt} fullscreen`}
          title="Open fullscreen"
        >
          <Expand size={16} />
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-[80] bg-slate-950/90 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-label={alt}>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="fixed right-5 top-5 z-[90] grid h-10 w-10 place-items-center rounded-full bg-white text-slate-950 shadow-lg hover:bg-slate-100"
            aria-label="Close screenshot"
          >
            <X size={20} />
          </button>
          <div className="mx-auto h-full max-w-6xl overflow-auto rounded-xl bg-slate-100">
            <img src={src} alt={alt} className="block h-auto w-full max-w-full" />
          </div>
        </div>
      )}
    </>
  );
}
