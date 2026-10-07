"use client";
import { useEffect, useRef, useState } from "react";

export interface Option { value: string; label: string; count?: number }

/** Выпадающий список с несколькими вариантами выбора и (по желанию) поиском */
export function MultiSelect({ label, options, value, onChange, searchable }: {
  label: string; options: Option[]; value: string[]; onChange: (v: string[]) => void; searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const sel = new Set(value);
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;
  const toggle = (v: string) => onChange(sel.has(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition ${value.length ? "border-brand bg-brand-light text-brand" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
        {label}{value.length > 0 && <span className="rounded bg-brand px-1.5 text-xs font-semibold text-white">{value.length}</span>}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          {searchable && <input autoFocus className="inp mb-2" placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} />}
          <ul className="max-h-64 overflow-auto">
            {shown.map((o) => (
              <li key={o.value}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={sel.has(o.value)} onChange={() => toggle(o.value)} />
                  <span className="min-w-0 flex-1 truncate" title={o.label}>{o.label}</span>
                  {o.count != null && <span className="text-xs text-slate-400">{o.count}</span>}
                </label>
              </li>
            ))}
            {!shown.length && <li className="px-2 py-1.5 text-sm text-slate-400">Ничего не найдено</li>}
          </ul>
          {value.length > 0 && <button className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-slate-500 hover:bg-slate-50" onClick={() => onChange([])}>Снять выбор</button>}
        </div>
      )}
    </div>
  );
}

export function Chip({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-light py-0.5 pl-3 pr-1 text-xs font-medium text-brand">
      {children}
      <button className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-brand/10" onClick={onRemove} title="Убрать фильтр" aria-label="Убрать фильтр">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12" /></svg>
      </button>
    </span>
  );
}
