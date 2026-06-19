import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { X } from "lucide-react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((message, type = "success") => {
    const id = crypto.randomUUID();
    setToasts((items) => [...items, { id, message, type }]);
    setTimeout(() => setToasts((items) => items.filter((toast) => toast.id !== id)), 3600);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-4 top-4 z-50 space-y-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex min-w-72 items-center gap-3 rounded-xl border px-4 py-3 shadow-soft backdrop-blur ${
              toast.type === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-slate-200 bg-white/95 text-slate-900"
            }`}
          >
            <span className="text-sm font-medium">{toast.message}</span>
            <button onClick={() => setToasts((items) => items.filter((item) => item.id !== toast.id))} className="ml-auto">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
