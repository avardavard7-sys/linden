"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

type Tone = "ok" | "error" | "info";
type ToastItem = { id: number; message: string; tone: Tone };

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const push = useCallback((message: string, tone: Tone = "info") => {
    const id = ++counter.current;
    setItems((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), 4500);
  }, []);

  const icons = useMemo(
    () => ({
      ok: <CheckCircle2 size={16} className="text-emerald-700 shrink-0" />,
      error: <AlertTriangle size={16} className="text-red-700 shrink-0" />,
      info: <Info size={16} className="text-oak shrink-0" />
    }),
    []
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
        {items.map((item) => (
          <div key={item.id} className="card shadow-lift px-4 py-3 flex items-start gap-2.5 text-sm fade-up">
            {icons[item.tone]}
            <span className="leading-snug">{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
