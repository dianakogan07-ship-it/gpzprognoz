"use client";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconDownload, IconEdit, IconHelp } from "./Icons";
import { DEFAULT_VAT } from "@/lib/logic";
import { Chip, MultiSelect } from "./MultiSelect";
import {
  CONTRACTS_LABEL, EMPTY_FILTERS, FLAG_LABEL, REASON_TEXT, REPEAT_LABEL, SOURCE_LABEL, STATUS_LABEL,
  actionHint, filterRows, filtersFromQuery, filtersToQuery, fmtGrowth, fmtRub, plural,
  regionKey, shortSource, sortRows,
  type ContractsBucket, type Filters, type Flag, type ReasonCode, type Repeat, type SortKey, type SourceKind, type Status, type ViewRow,
} from "@/lib/forecastView";
import type { Source } from "@/lib/types";

const PAGE = 200;


const STATUS_STYLE: Record<Status, string> = {
  reliable: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  check: "bg-amber-50 text-amber-800 ring-amber-200",
  lowdata: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function StatusPill({ v, hidden }: { v: ViewRow; hidden: ReasonCode | null }) {
  const reasons = v.reasons.filter((r) => r !== hidden);
  const title = reasons.length ? reasons.map((r) => `• ${REASON_TEXT[r]}`).join("\n") : "Отраслевой утверждённый индекс, не меньше трёх договоров";
  return <span title={title} className={`inline-flex cursor-help whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ${STATUS_STYLE[v.status]}`}>{STATUS_LABEL[v.status]}</span>;
}

/** Расчёт по шагам простым языком */
export function Steps({ v, baseYear, sources }: { v: ViewRow; baseYear: number; sources: Source[] }) {
  const r = v.row;
  const src = shortSource(r.indexSourceCode, sources);
  const n = r.prices.length;
  const prices = r.prices.length > 7 ? `${r.prices.slice(0, 3).map(fmtNum).join(" / ")} … ${r.prices.slice(-2).map(fmtNum).join(" / ")}` : r.prices.map(fmtNum).join(" / ");
  const dec = {
    not_needed: "не требуется (договоры заключены в декабре)",
    applied: `${fmtRub(r.basePrice)}`,
    partial: `частично (не для всех договоров есть индекс), ${fmtRub(r.basePrice)}`,
    none: "нет данных, цена без изменений",
  }[r.toDecember];
  const idx = r.indexLevel === "okpd2" ? `отраслевой индекс ОКПД2 ${r.indexKey}` : r.indexLevel === "okved2" ? `отраслевой индекс раздела ОКВЭД2 ${r.indexKey}` : r.indexApproved === null ? "индекс не найден" : "общая инфляция";
  return (
    <div className="space-y-3 text-sm">
      <p className="leading-relaxed text-slate-700">
        <b>{n} {plural(n, "договор", "договора", "договоров")} {baseYear} года:</b> {prices} ₽ за {r.unitLabel}, медиана {fmtRub(r.rawMedian)}
        <Arrow />пересчёт до последнего месяца с данными: {dec}
        <Arrow />рост {fmtGrowth(v.growth)} ({idx}{src && <>, <a className="text-brand hover:underline" href={src.url} target="_blank" rel="noreferrer">{src.name}</a></>})
        <Arrow /><b className="text-slate-900">прогноз {fmtRub(r.forecastPrice)}</b>
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {r.repeatable === false && <p className="text-slate-600">Разовая закупка — цена справочная.</p>}
        {r.outlierPrices.length > 0 && (
          <div>
            <p className="font-medium text-slate-900">Не вошли в медиану (отличаются больше чем в 2 раза)</p>
            <p className="mt-1 text-slate-600">{r.outlierPrices.map(fmtRub).join(", ")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
const Arrow = () => <span className="mx-1.5 text-slate-400">→</span>;
const fmtNum = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

function SortTh({ k, f, set, children, right, extra }: { k: SortKey; f: Filters; set: (p: Partial<Filters>) => void; children: React.ReactNode; right?: boolean; extra?: ReactNode }) {
  const active = f.sort === k;
  return (
    <th className={`whitespace-nowrap ${right ? "text-right" : ""}`}>
      <button className={`inline-flex items-center gap-1 whitespace-nowrap uppercase hover:text-slate-800 ${active ? "text-brand" : ""}`}
        onClick={() => set(active ? (f.dir === "asc" ? { dir: "desc" } : { sort: null, dir: "asc" }) : { sort: k, dir: k === "subject" || k === "region" ? "asc" : "desc" })}>
        {children}<span className="text-[10px]">{active ? (f.dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>{extra}
    </th>
  );
}


/** Фильтры таблицы прогноза с сохранением в адресе страницы и поиском с задержкой */
export function useForecastFilters() {
  const [f, setF] = useState<Filters>(EMPTY_FILTERS);
  const [qInput, setQInput] = useState("");
  const [gMin, setGMin] = useState("");
  const [gMax, setGMax] = useState("");
  const ready = useRef(false);
  useEffect(() => {
    const init = filtersFromQuery(window.location.search);
    setF(init); setQInput(init.q);
    setGMin(init.growthMin == null ? "" : String(init.growthMin)); setGMax(init.growthMax == null ? "" : String(init.growthMax));
    ready.current = true;
  }, []);
  useEffect(() => {
    if (!ready.current) return;
    const keep = new URLSearchParams(window.location.search);
    const qs = new URLSearchParams(filtersToQuery(f));
    // Параметры страницы (вкладки, версии) сохраняем
    for (const [k, v] of keep) if (["tab", "v", "a", "b", "with"].includes(k)) qs.set(k, v);
    const s = qs.toString();
    window.history.replaceState(null, "", s ? `?${s}` : window.location.pathname);
  }, [f]);
  useEffect(() => {
    const t = setTimeout(() => setF((p) => (p.q === qInput ? p : { ...p, q: qInput })), 200);
    return () => clearTimeout(t);
  }, [qInput]);
  const set = (p: Partial<Filters>) => setF((prev) => ({ ...prev, ...p }));
  const resetAll = () => { setQInput(""); setGMin(""); setGMax(""); setF((p) => ({ ...EMPTY_FILTERS, sort: p.sort, dir: p.dir, exFile: p.exFile, exReason: p.exReason })); };
  return { f, set, setF, qInput, setQInput, gMin, setGMin, gMax, setGMax, resetAll };
}
export type ForecastFilters = ReturnType<typeof useForecastFilters>;

/** Таблица позиций прогноза: фильтры, сортировка, раскрытие строки, выгрузка текущей выборки */
export function ForecastTable({ view, filters, baseYear, targetYear, sources, onExport, onEdit, onReview, rowDetails, showMeta }: {
  view: ViewRow[];
  filters: ForecastFilters;
  baseYear: number;
  targetYear: number;
  sources: Source[];
  onExport: (rows: ViewRow[]) => void;
  onEdit?: (v: ViewRow) => void;
  /** Смена статуса строки: «Проверить» / «Утверждено» */
  onReview?: (v: ViewRow, approved: boolean) => void;
  rowDetails?: (v: ViewRow) => ReactNode;
  /** Сохранённый прогноз: фильтры по отметкам проверки и правкам */
  showMeta?: boolean;
}) {
  const { f, set, qInput, setQInput, gMin, setGMin, gMax, setGMax, resetAll } = filters;
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [more, setMore] = useState(false);
  useEffect(() => setLimit(PAGE), [f]);
  const filtered = useMemo(() => sortRows(filterRows(view, f), f.sort, f.dir), [view, f]);
  const hint = useMemo(() => { const h = actionHint(view); return h && h.reason !== "not_december" ? h : null; }, [view]);
  const counts = useMemo(() => {
    const status: Record<Status, number> = { reliable: 0, check: 0, lowdata: 0 };
    const cat = new Map<string, number>(), reg = new Map<string, { label: string; n: number }>(), method = new Map<string, number>();
    for (const v of view) {
      status[v.status]++;
      cat.set(v.row.category ?? "", (cat.get(v.row.category ?? "") ?? 0) + 1);
      method.set(v.row.method ?? "", (method.get(v.row.method ?? "") ?? 0) + 1);
      const k = regionKey(v.row);
      const e = reg.get(k) ?? { label: v.row.regionName ?? (v.row.region || "Не указан"), n: 0 };
      e.n++; reg.set(k, e);
    }
    return { status, cat, reg, method };
  }, [view]);
  const regionLabel = (k: string) => counts.reg.get(k)?.label ?? k;
  const chips: { key: string; label: string; remove: () => void }[] = [
    ...(f.q ? [{ key: "q", label: `Поиск: «${f.q}»`, remove: () => { setQInput(""); set({ q: "" }); } }] : []),
    ...f.status.map((s) => ({ key: `st${s}`, label: APPROVAL_LABEL[s], remove: () => set({ status: f.status.filter((x) => x !== s) }) })),
    ...f.category.map((c) => ({ key: `c${c}`, label: c || "Без категории", remove: () => set({ category: f.category.filter((x) => x !== c) }) })),
    ...f.method.map((c) => ({ key: `m${c}`, label: c || "Способ не указан", remove: () => set({ method: f.method.filter((x) => x !== c) }) })),
    ...f.region.map((c) => ({ key: `r${c}`, label: regionLabel(c), remove: () => set({ region: f.region.filter((x) => x !== c) }) })),
    ...(f.okpd ? [{ key: "okpd", label: `ОКПД2: ${f.okpd}*`, remove: () => set({ okpd: "" }) }] : []),
    ...f.source.map((s) => ({ key: `s${s}`, label: SOURCE_LABEL[s], remove: () => set({ source: f.source.filter((x) => x !== s) }) })),
    ...f.contracts.map((s) => ({ key: `n${s}`, label: `Договоров: ${CONTRACTS_LABEL[s]}`, remove: () => set({ contracts: f.contracts.filter((x) => x !== s) }) })),
    ...(f.growthMin != null || f.growthMax != null ? [{
      key: "g", label: `Рост ${f.growthMin != null ? `от ${f.growthMin} %` : ""} ${f.growthMax != null ? `до ${f.growthMax} %` : ""}`.replace(/\s+/g, " ").trim(),
      remove: () => { setGMin(""); setGMax(""); set({ growthMin: null, growthMax: null }); },
    }] : []),
    ...f.repeat.map((s) => ({ key: `p${s}`, label: REPEAT_LABEL[s], remove: () => set({ repeat: f.repeat.filter((x) => x !== s) }) })),
    ...f.flags.map((s) => ({ key: `f${s}`, label: FLAG_LABEL[s], remove: () => set({ flags: f.flags.filter((x) => x !== s) }) })),
  ];
  // Сколько фильтров включено в «Ещё фильтры»
  const moreCount = f.method.length + f.source.length + f.contracts.length + f.repeat.length + f.flags.length
    + (f.okpd ? 1 : 0) + (f.growthMin != null || f.growthMax != null ? 1 : 0);
  const toggleRow = (id: number) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const hasMethods = counts.method.size > 1 || !counts.method.has("");
  const cols = 11;

  return (
    <>
      {hint && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-3">
          <p className="text-sm text-amber-900">{hint.text}</p>
          <Link href={hint.href} className="btn-sec">{hint.action}</Link>
        </div>
      )}
      <div className="card space-y-3">
            {/* Фильтры */}
            <div className="flex flex-wrap items-center gap-2">
              <input className="inp w-72 py-1.5" placeholder="Поиск по предмету или коду ОКПД2" value={qInput} onChange={(e) => setQInput(e.target.value)} />
              <MultiSelect label="Категория" value={f.category} onChange={(category) => set({ category })}
                options={[...counts.cat.entries()].sort().map(([c, n]) => ({ value: c, label: c || "Без категории", count: n }))} />
              <MultiSelect label="Регион" searchable value={f.region} onChange={(region) => set({ region })}
                options={[...counts.reg.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, "ru")).map(([k, e]) => ({ value: k, label: e.label, count: e.n }))} />
              <MultiSelect label="Статус" value={f.status} onChange={(v) => set({ status: v as Status[] })}
                options={(["check", "reliable"] as Status[]).map((s) => ({ value: s, label: APPROVAL_LABEL[s], count: counts.status[s] }))} />
              <button type="button" aria-expanded={more} onClick={() => setMore(!more)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${more || moreCount ? "border-brand bg-brand-light text-brand" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
                Ещё фильтры{moreCount ? ` (${moreCount})` : ""} <span className={`inline-block transition ${more ? "rotate-180" : ""}`}>▾</span>
              </button>
              <span className="ml-auto text-sm text-slate-600">Показано <b>{filtered.length}</b> из {view.length}</span>
              <button className="btn-sec" title="Выгрузить позиции, которые сейчас в таблице" onClick={() => onExport(filtered)}><IconDownload />Excel</button>
            </div>
            <div className={`grid transition-all duration-200 ${more ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
              <div className={more ? "" : "overflow-hidden"}>
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  {hasMethods && <MultiSelect label="Способ закупки" value={f.method} onChange={(method) => set({ method })}
                    options={[...counts.method.entries()].sort().map(([c, n]) => ({ value: c, label: c || "Не указан", count: n }))} />}
                  <input className="inp w-32 py-1.5" placeholder="Код ОКПД2" title="Начало кода ОКПД2, например 28 или 09.10" value={f.okpd} onChange={(e) => set({ okpd: e.target.value })} />
                  <MultiSelect label="Источник индекса" value={f.source} onChange={(v) => set({ source: v as SourceKind[] })}
                    options={(Object.keys(SOURCE_LABEL) as SourceKind[]).map((s) => ({ value: s, label: SOURCE_LABEL[s] }))} />
                  <MultiSelect label="Договоров" value={f.contracts} onChange={(v) => set({ contracts: v as ContractsBucket[] })}
                    options={(Object.keys(CONTRACTS_LABEL) as ContractsBucket[]).map((s) => ({ value: s, label: CONTRACTS_LABEL[s] }))} />
                  <MultiSelect label="Повторяемость" value={f.repeat} onChange={(v) => set({ repeat: v as Repeat[] })}
                    options={(Object.keys(REPEAT_LABEL) as Repeat[]).map((s) => ({ value: s, label: REPEAT_LABEL[s] }))} />
                  <MultiSelect label="Отметки" value={f.flags} onChange={(v) => set({ flags: v as Flag[] })}
                    options={(Object.keys(FLAG_LABEL) as Flag[]).filter((x) => showMeta || x === "review").map((s) => ({ value: s, label: FLAG_LABEL[s] }))} />
                  <span className="inline-flex items-center gap-1 text-sm text-slate-600">Рост, %
                    <input className="inp w-16 py-1.5" inputMode="decimal" placeholder="от" value={gMin} onChange={(e) => { setGMin(e.target.value); set({ growthMin: numOrNull(e.target.value) }); }} />
                    <input className="inp w-16 py-1.5" inputMode="decimal" placeholder="до" value={gMax} onChange={(e) => { setGMax(e.target.value); set({ growthMax: numOrNull(e.target.value) }); }} />
                  </span>
                </div>
              </div>
            </div>
            {chips.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {chips.map((c) => <Chip key={c.key} onRemove={c.remove}>{c.label}</Chip>)}
                <button className="text-sm text-slate-500 hover:text-slate-900 hover:underline" onClick={resetAll}>Сбросить всё</button>
              </div>
            )}

            {/* Таблица */}
            <div className="overflow-x-auto"><table className="tbl table-fixed min-w-[1180px]">
              <colgroup><col className="w-8" /><col /><col className="w-28" /><col className="w-28" /><col className="w-12" /><col className="w-24" /><col className="w-28" /><col className="w-24" /><col className="w-32" /><col className="w-44" /><col className="w-16" /></colgroup>
              <thead>
                <tr>
                  <th />
                  <SortTh k="subject" f={f} set={set}>Предмет</SortTh>
                  <th>Категория</th>
                  <SortTh k="region" f={f} set={set}>Регион</SortTh>
                  <th>Ед.</th>
                  <SortTh k="price" f={f} set={set} right extra={<PriceInfo />}>Цена {baseYear}</SortTh>
                  <SortTh k="forecast" f={f} set={set} right>Прогноз {targetYear}</SortTh>
                  <th className="whitespace-nowrap text-right">С НДС</th>
                  <th>Статус</th>
                  <th>Комментарий</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={cols} className="py-10 text-center text-slate-500">
                    Нет позиций по выбранным фильтрам. <button className="text-brand hover:underline" onClick={resetAll}>Сбросить всё</button>
                  </td></tr>
                )}
                {filtered.slice(0, limit).map((v) => {
                  const r = v.row, open = expanded.has(v.id);
                  return (
                    <Fragment key={v.id}>
                      <tr className={`group cursor-pointer ${open ? "bg-brand-light/40" : ""}`} onClick={() => toggleRow(v.id)}>
                        <td className="text-slate-400"><span className={`inline-block transition ${open ? "rotate-90" : ""}`}>›</span></td>
                        <td className="break-words text-slate-900">{r.subject}</td>
                        <td className="hyphens-auto text-slate-700" lang="ru">{r.category ?? <span className="text-slate-400">—</span>}</td>
                        <td className="break-words text-slate-700">{r.regionName ?? r.region ?? "—"}</td>
                        <td className="text-slate-700">{r.unitLabel}</td>
                        <td className="whitespace-nowrap text-right">{fmtRub(r.basePrice)}</td>
                        <td className="text-right">
                          <div className="whitespace-nowrap text-base font-semibold text-slate-900">{fmtRub(r.forecastPrice)}</div>
                          <div className={`text-xs ${v.growth < 0 ? "text-red-600" : "text-slate-400"}`}>{fmtGrowth(v.growth)}</div>
                        </td>
                        <td className="text-right" title={r.vatRate == null ? "Ставки НДС нет в файлах — взята 22 %" : undefined}>
                          <div className="whitespace-nowrap text-slate-900">{fmtRub(Math.round(r.forecastPrice * (1 + (r.vatRate ?? DEFAULT_VAT)) * 100) / 100)}</div>
                          <div className="text-xs text-slate-400">НДС {Math.round((r.vatRate ?? DEFAULT_VAT) * 100)} %{r.vatRate == null ? "*" : ""}</div>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}><StatusPick v={v} onChange={onReview} /></td>
                        <td className="text-xs leading-snug text-slate-600">
                          {v.reasons.map((x) => <p key={x}>{REASON_TEXT[x]}</p>)}
                          {v.meta?.edited && <p className="text-brand">Есть ручные правки</p>}
                        </td>
                        <td className="whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                          {onEdit && (
                            <button type="button" title="Изменить" aria-label="Изменить" onClick={() => onEdit(v)}
                              className="rounded-lg p-1.5 text-slate-500 opacity-0 transition hover:bg-slate-100 hover:text-brand focus:opacity-100 group-hover:opacity-100">
                              <IconEdit width={16} height={16} />
                            </button>
                          )}
                          {v.meta && (
                            <Link href={`/logic?row=${v.meta.itemId}`} title="Как посчитано" aria-label="Как посчитано"
                              className="inline-flex rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-brand">
                              <IconHelp width={16} height={16} />
                            </Link>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-brand-light/40"><td /><td colSpan={cols - 1} className="pb-4">
                          <p className="mb-2 text-xs text-slate-500">
                            ОКПД2 {r.okpd2}{r.category ? ` · ${r.category}` : ""} · по {r.contracts} {plural(r.contracts, "договору", "договорам", "договорам")}
                          </p>
                          <Steps v={v} baseYear={baseYear} sources={sources} />{rowDetails?.(v)}
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table></div>
            {filtered.length > limit && (
              <div className="text-center"><button className="btn-sec" onClick={() => setLimit(limit + PAGE)}>Показать ещё {Math.min(PAGE, filtered.length - limit)} из {filtered.length - limit}</button></div>
            )}
      </div>
    </>
  );
}

export const APPROVAL_LABEL: Record<Status, string> = { check: "Проверить", reliable: "Утверждено", lowdata: "Проверить" };
const PILL: Record<"check" | "reliable", string> = { check: "bg-amber-500", reliable: "bg-emerald-600" };

/** Статус строки: цветная плашка с выбором «Проверить» / «Утверждено» */
function StatusPick({ v, onChange }: { v: ViewRow; onChange?: (v: ViewRow, approved: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const cur = v.status === "reliable" ? "reliable" : "check";
  const pill = <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold text-white ${PILL[cur]}`}>{cur === "reliable" ? "✓ " : ""}{APPROVAL_LABEL[cur]}</span>;
  if (!onChange) return pill;
  return (
    <div className="relative inline-block" ref={ref}>
      <button type="button" className="inline-flex items-center gap-1" onClick={() => setOpen(!open)} aria-label="Сменить статус">
        {pill}<span className="text-xs text-slate-400">⌄</span>
      </button>
      {open && (
        <ul className="absolute left-0 z-30 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {(["check", "reliable"] as const).map((k) => (
            <li key={k}>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                onClick={() => { setOpen(false); if (k !== cur) onChange(v, k === "reliable"); }}>
                <span className={`h-2.5 w-2.5 rounded-full ${PILL[k]}`} />{APPROVAL_LABEL[k]}
                {k === cur && <span className="ml-auto text-brand">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Подсказка у колонки цены базового года */
function PriceInfo() {
  return (
    <span className="group/info relative ml-1 inline-flex align-middle normal-case" onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label="Пояснение к цене" className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-400 text-[10px] font-semibold leading-none text-slate-500 hover:border-brand hover:text-brand">i</button>
      <span className="invisible absolute right-0 top-full z-20 mt-1 w-60 rounded-lg border border-slate-200 bg-white p-3 text-left text-xs font-normal tracking-normal text-slate-700 opacity-0 shadow-lg transition group-hover/info:visible group-hover/info:opacity-100 group-focus-within/info:visible group-focus-within/info:opacity-100">
        Цены из договоров разных месяцев. Для точности уточните индексы.{" "}
        <Link href="/indices" className="text-brand hover:underline">Индексы</Link>
      </span>
    </span>
  );
}

function numOrNull(s: string): number | null {
  const t = s.replace(",", ".").replace("−", "-").trim();
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
