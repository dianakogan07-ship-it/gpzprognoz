"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface MenuItem { label: string; onClick: () => void; danger?: boolean }

/** Меню «⋮» с действиями */
export function Menu({ items, light, children }: { items: MenuItem[]; light?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="relative" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label="Действия" onClick={() => setOpen(!open)}
        className={`flex h-8 w-8 items-center justify-center rounded-lg text-lg leading-none ${light ? "text-white/90 hover:bg-white/15" : "text-slate-500 hover:bg-slate-100"}`}>
        {children ?? "⋮"}
      </button>
      {open && (
        <ul className="absolute right-0 z-30 mt-1 w-52 rounded-lg border border-slate-200 bg-white py-1 text-sm text-slate-800 shadow-lg">
          {items.map((it) => (
            <li key={it.label}>
              <button type="button" className={`block w-full px-3 py-2 text-left hover:bg-slate-50 ${it.danger ? "text-red-700" : ""}`}
                onClick={() => { setOpen(false); it.onClick(); }}>{it.label}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
