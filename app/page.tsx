"use client";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { parseGpz, parseReport } from "@/lib/parse";
import { buildForecast, type ForecastResult } from "@/lib/forecast";
import { downloadWorkbook, forecastWorkbook } from "@/lib/excel";
import { api, useReference } from "@/components/useReference";
import { FilePick } from "@/components/FilePick";
import { IconDownload, IconPlay } from "@/components/Icons";
import { Chip, MultiSelect } from "@/components/MultiSelect";
import { COVERAGE_KEY, buildCoverage } from "@/lib/indexFormat";
import {
  CONTRACTS_LABEL, EMPTY_FILTERS, REASON_TEXT, REPEAT_LABEL, SOURCE_LABEL, STATUS_LABEL,
  actionHint, filterExcluded, filterRows, filtersFromQuery, filtersToQuery, fmtGrowth, fmtRub, plural,
  reasonGroup, regionKey, shortSource, sortRows, toViewRows,
  type ContractsBucket, type Filters, type ReasonCode, type Repeat, type SortKey, type SourceKind, type Status, type ViewRow,
} from "@/lib/forecastView";
import type { Source } from "@/lib/types";

const RESULT_KEY = "gpz_forecast_result";
const PAGE = 200;

const STATUS_STYLE: Record<Status, string> = {
  reliable: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  check: "bg-amber-50 text-amber-800 ring-amber-200",
  lowdata: "bg-slate-100 text-slate-600 ring-slate-200",
};

function StatusPill({ v, hidden }: { v: ViewRow; hidden: ReasonCode | null }) {
  const reasons = v.reasons.filter((r) => r !== hidden);
  const title = reasons.length ? reasons.map((r) => `• ${REASON_TEXT[r]}`).join("\n") : "Отраслевой утверждённый индекс, не меньше трёх договоров";
  return <span title={title} className={`inline-flex cursor-help whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ${STATUS_STYLE[v.status]}`}>{STATUS_LABEL[v.status]}</span>;
}

/** Расчёт по шагам простым языком */
function Steps({ v, baseYear, sources }: { v: ViewRow; baseYear: number; sources: Source[] }) {
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
        <Arrow />доведение до декабря: {dec}
        <Arrow />рост {fmtGrowth(v.growth)} ({idx}{src && <>, <a className="text-brand hover:underline" href={src.url} target="_blank" rel="noreferrer">{src.name}</a></>})
        <Arrow /><b className="text-slate-900">прогноз {fmtRub(r.forecastPrice)}</b>
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="font-medium text-slate-900">Статус «{STATUS_LABEL[v.status]}»</p>
          {v.reasons.length ? <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-600">{v.reasons.map((x) => <li key={x}>{REASON_TEXT[x]}</li>)}</ul>
            : <p className="mt-1 text-slate-600">Отраслевой утверждённый индекс, не меньше трёх договоров.</p>}
          {r.repeatable === false && <p className="mt-1 text-slate-600">Разовая закупка — цена справочная.</p>}
        </div>
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

function SortTh({ k, f, set, children, right }: { k: SortKey; f: Filters; set: (p: Partial<Filters>) => void; children: React.ReactNode; right?: boolean }) {
  const active = f.sort === k;
  return (
    <th className={right ? "text-right" : ""}>
      <button className={`inline-flex items-center gap-1 uppercase hover:text-slate-800 ${active ? "text-brand" : ""}`}
        onClick={() => set(active ? (f.dir === "asc" ? { dir: "desc" } : { sort: null, dir: "asc" }) : { sort: k, dir: k === "subject" || k === "region" ? "asc" : "desc" })}>
        {children}<span className="text-[10px]">{active ? (f.dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}

export default function ForecastPage() {
  const { reference, db, error } = useReference();
  const [gpz, setGpz] = useState<File | null>(null);
  const [rep, setRep] = useState<File | null>(null);
  const [baseYear, setBaseYear] = useState(2026);
  const [res, setRes] = useState<ForecastResult | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<Filters>(EMPTY_FILTERS);
  const [qInput, setQInput] = useState("");
  const [gMin, setGMin] = useState("");
  const [gMax, setGMax] = useState("");
  const [showExcluded, setShowExcluded] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [exportAll, setExportAll] = useState(false);
  const ready = useRef(false);

  // Восстановление фильтров из адреса и последнего расчёта (данные хранятся только в этой вкладке браузера)
  useEffect(() => {
    const init = filtersFromQuery(window.location.search);
    setF(init); setQInput(init.q);
    setGMin(init.growthMin == null ? "" : String(init.growthMin)); setGMax(init.growthMax == null ? "" : String(init.growthMax));
    try {
      const saved = sessionStorage.getItem(RESULT_KEY);
      if (saved) { const s = JSON.parse(saved); setRes(s.res); setBaseYear(s.baseYear); }
    } catch { /* недоступно */ }
    ready.current = true;
  }, []);
  // Фильтры → адрес страницы
  useEffect(() => {
    if (!ready.current) return;
    const qs = filtersToQuery(f);
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [f]);
  // Поиск с задержкой, чтобы не пересчитывать на каждый символ
  useEffect(() => {
    const t = setTimeout(() => setF((p) => (p.q === qInput ? p : { ...p, q: qInput })), 200);
    return () => clearTimeout(t);
  }, [qInput]);
  useEffect(() => setLimit(PAGE), [f]);

  const set = (p: Partial<Filters>) => setF((prev) => ({ ...prev, ...p }));

  async function run() {
    if (!gpz || !rep || !reference) return;
    setBusy(true); setMsg(null); setRes(null); setExpanded(new Set());
    try {
      const g = parseGpz(await gpz.arrayBuffer(), reference.regions.map((r) => r.code));
      const r = parseReport(await rep.arrayBuffer());
      const result = buildForecast(g.rows, r.rows, reference, { baseYear, targetYear: baseYear + 1 });
      setRes(result);
      try { sessionStorage.setItem(RESULT_KEY, JSON.stringify({ res: result, baseYear })); } catch { /* слишком большой результат или хранилище недоступно */ }
      try { localStorage.setItem(COVERAGE_KEY, JSON.stringify(buildCoverage(result.rows, baseYear + 1))); } catch { /* недоступно */ }
      if (result.newWsCodes.length && db) {
        await api("/api/ws/auto", "POST", { codes: result.newWsCodes });
        setMsg(`В справочник WS добавлены новые коды: ${result.newWsCodes.join(", ")}`);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const view = useMemo(() => toViewRows(res?.rows ?? []), [res]);
  const filtered = useMemo(() => sortRows(filterRows(view, f), f.sort, f.dir), [view, f]);
  const hint = useMemo(() => actionHint(view), [view]);
  const counts = useMemo(() => {
    const status: Record<Status, number> = { reliable: 0, check: 0, lowdata: 0 };
    const cat = new Map<string, number>(), reg = new Map<string, { label: string; n: number }>();
    for (const v of view) {
      status[v.status]++;
      cat.set(v.row.category ?? "", (cat.get(v.row.category ?? "") ?? 0) + 1);
      const k = regionKey(v.row);
      const e = reg.get(k) ?? { label: v.row.regionName ?? (v.row.region || "Не указан"), n: 0 };
      e.n++; reg.set(k, e);
    }
    return { status, cat, reg };
  }, [view]);
  const excludedShown = useMemo(() => filterExcluded(res?.excluded ?? [], f), [res, f]);
  const excludedReasons = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of res?.excluded ?? []) m.set(reasonGroup(e.reason), (m.get(reasonGroup(e.reason)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [res]);

  const regionLabel = (k: string) => counts.reg.get(k)?.label ?? k;
  const chips: { key: string; label: string; remove: () => void }[] = [
    ...(f.q ? [{ key: "q", label: `Поиск: «${f.q}»`, remove: () => { setQInput(""); set({ q: "" }); } }] : []),
    ...f.status.map((s) => ({ key: `st${s}`, label: STATUS_LABEL[s], remove: () => set({ status: f.status.filter((x) => x !== s) }) })),
    ...f.category.map((c) => ({ key: `c${c}`, label: c || "Без категории", remove: () => set({ category: f.category.filter((x) => x !== c) }) })),
    ...f.region.map((c) => ({ key: `r${c}`, label: regionLabel(c), remove: () => set({ region: f.region.filter((x) => x !== c) }) })),
    ...(f.okpd ? [{ key: "okpd", label: `ОКПД2: ${f.okpd}*`, remove: () => set({ okpd: "" }) }] : []),
    ...f.source.map((s) => ({ key: `s${s}`, label: SOURCE_LABEL[s], remove: () => set({ source: f.source.filter((x) => x !== s) }) })),
    ...f.contracts.map((s) => ({ key: `n${s}`, label: `Договоров: ${CONTRACTS_LABEL[s]}`, remove: () => set({ contracts: f.contracts.filter((x) => x !== s) }) })),
    ...(f.growthMin != null || f.growthMax != null ? [{
      key: "g", label: `Рост ${f.growthMin != null ? `от ${f.growthMin} %` : ""} ${f.growthMax != null ? `до ${f.growthMax} %` : ""}`.replace(/\s+/g, " ").trim(),
      remove: () => { setGMin(""); setGMax(""); set({ growthMin: null, growthMax: null }); },
    }] : []),
    ...f.repeat.map((s) => ({ key: `p${s}`, label: REPEAT_LABEL[s], remove: () => set({ repeat: f.repeat.filter((x) => x !== s) }) })),
  ];
  const resetAll = () => { setQInput(""); setGMin(""); setGMax(""); setF((p) => ({ ...EMPTY_FILTERS, sort: p.sort, dir: p.dir, exFile: p.exFile, exReason: p.exReason })); };
  const toggleRow = (id: number) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  function exportExcel() {
    if (!res || !reference) return;
    const rows = exportAll ? res.rows : filtered.map((v) => v.row);
    downloadWorkbook(forecastWorkbook(res, reference.sources, baseYear + 1, rows), `Прогноз_цен_${baseYear + 1}${exportAll || !chips.length ? "" : "_отбор"}.xlsx`);
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-4">
        <h1 className="text-xl font-semibold text-slate-900">Прогноз цен на {baseYear + 1} год</h1>
        <p className="hint">Файлы читаются в браузере и не передаются на сервер. С сервера загружаются только справочники и индексы.</p>
        {error && <p className="text-sm text-red-700">{error}</p>}
        {db === false && <p className="text-sm text-amber-700">База данных не подключена — используются встроенные справочники.</p>}
        <div className="grid items-end gap-4 md:grid-cols-[1fr_1fr_12rem]">
          <div><span className="field-label">ГПЗ {baseYear}</span><FilePick label="Выберите файл ГПЗ .xlsx" hint="Выгрузка годового плана закупок" file={gpz} onChange={setGpz} /></div>
          <div><span className="field-label">Отчётность {baseYear}</span><FilePick label="Выберите файл отчётности .xlsx" hint="Выгрузка заключённых договоров" file={rep} onChange={setRep} /></div>
          <div><label className="field-label" htmlFor="by">Базовый год</label><input id="by" type="number" className="inp py-2" value={baseYear} onChange={(e) => setBaseYear(Number(e.target.value))} /></div>
        </div>
        <button className="btn" disabled={!gpz || !rep || !reference || busy} onClick={run}><IconPlay width={16} height={16} />{busy ? "Расчёт…" : "Рассчитать прогноз"}</button>
        {msg && <p className="text-sm text-slate-700">{msg}</p>}
      </div>

      {res && (
        <>
          {/* Сводка */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="card py-4">
              <p className="hint">Прогноз готов</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{res.rows.length} <span className="text-base font-normal text-slate-500">{plural(res.rows.length, "позиция", "позиции", "позиций")}</span></p>
              <p className="hint mt-1">по {res.stats.used} {plural(res.stats.used, "договору", "договорам", "договорам")}</p>
            </div>
            <button className={`card py-4 text-left transition hover:border-amber-300 ${f.status.length === 1 && f.status[0] === "check" ? "border-amber-300 ring-2 ring-amber-100" : ""}`}
              onClick={() => set({ status: f.status.length === 1 && f.status[0] === "check" ? [] : ["check"] })}>
              <p className="hint">Требуют проверки</p>
              <p className="mt-1 text-2xl font-semibold text-amber-700">{counts.status.check}</p>
              <p className="hint mt-1">{f.status.length === 1 && f.status[0] === "check" ? "Показать все позиции" : "Показать только их"}{counts.status.lowdata > 0 && ` · ещё ${counts.status.lowdata} с малым числом договоров`}</p>
            </button>
            <button className={`card py-4 text-left transition hover:border-slate-300 ${showExcluded ? "ring-2 ring-slate-200" : ""}`} onClick={() => setShowExcluded(!showExcluded)}>
              <p className="hint">Не вошли в расчёт</p>
              <p className="mt-1 text-2xl font-semibold text-slate-700">{res.excluded.length} <span className="text-base font-normal text-slate-500">{plural(res.excluded.length, "строка", "строки", "строк")}</span></p>
              <p className="hint mt-1">{showExcluded ? "Скрыть список" : "Показать причины"}</p>
            </button>
          </div>

          {showExcluded && (
            <div className="card space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="mr-2 font-semibold text-slate-900">Не вошли в расчёт</p>
                <MultiSelect label="Файл" value={f.exFile} onChange={(exFile) => set({ exFile })}
                  options={["ГПЗ", "Отчётность"].map((x) => ({ value: x, label: x, count: res.excluded.filter((e) => e.file === x).length }))} />
                <MultiSelect label="Причина" value={f.exReason} onChange={(exReason) => set({ exReason })}
                  options={excludedReasons.map(([r, n]) => ({ value: r, label: r, count: n }))} />
                <span className="hint ml-auto">Показано {excludedShown.length} из {res.excluded.length}</span>
              </div>
              <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
                <table className="tbl">
                  <thead><tr><th>Файл</th><th>Строка</th><th>Лот / ID</th><th>Причина</th></tr></thead>
                  <tbody>{excludedShown.slice(0, 1000).map((e, i) => <tr key={i}><td>{e.file}</td><td>{e.row}</td><td className="break-all">{e.lot}</td><td>{e.reason}</td></tr>)}</tbody>
                </table>
              </div>
              {excludedShown.length > 1000 && <p className="hint">Показаны первые 1000 строк. Полный список — на листе «Не вошли» в выгрузке Excel.</p>}
            </div>
          )}

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
              <MultiSelect label="Статус" value={f.status} onChange={(v) => set({ status: v as Status[] })}
                options={(Object.keys(STATUS_LABEL) as Status[]).map((s) => ({ value: s, label: STATUS_LABEL[s], count: counts.status[s] }))} />
              <MultiSelect label="Категория" value={f.category} onChange={(category) => set({ category })}
                options={[...counts.cat.entries()].sort().map(([c, n]) => ({ value: c, label: c || "Без категории", count: n }))} />
              <MultiSelect label="Регион" searchable value={f.region} onChange={(region) => set({ region })}
                options={[...counts.reg.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, "ru")).map(([k, e]) => ({ value: k, label: e.label, count: e.n }))} />
              <input className="inp w-32 py-1.5" placeholder="Код ОКПД2" title="Начало кода ОКПД2, например 28 или 09.10" value={f.okpd} onChange={(e) => set({ okpd: e.target.value })} />
              <MultiSelect label="Источник индекса" value={f.source} onChange={(v) => set({ source: v as SourceKind[] })}
                options={(Object.keys(SOURCE_LABEL) as SourceKind[]).map((s) => ({ value: s, label: SOURCE_LABEL[s] }))} />
              <MultiSelect label="Договоров" value={f.contracts} onChange={(v) => set({ contracts: v as ContractsBucket[] })}
                options={(Object.keys(CONTRACTS_LABEL) as ContractsBucket[]).map((s) => ({ value: s, label: CONTRACTS_LABEL[s] }))} />
              <MultiSelect label="Повторяемость" value={f.repeat} onChange={(v) => set({ repeat: v as Repeat[] })}
                options={(Object.keys(REPEAT_LABEL) as Repeat[]).map((s) => ({ value: s, label: REPEAT_LABEL[s] }))} />
              <span className="inline-flex items-center gap-1 text-sm text-slate-600">Рост, %
                <input className="inp w-16 py-1.5" inputMode="decimal" placeholder="от" value={gMin} onChange={(e) => { setGMin(e.target.value); set({ growthMin: numOrNull(e.target.value) }); }} />
                <input className="inp w-16 py-1.5" inputMode="decimal" placeholder="до" value={gMax} onChange={(e) => { setGMax(e.target.value); set({ growthMax: numOrNull(e.target.value) }); }} />
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {chips.map((c) => <Chip key={c.key} onRemove={c.remove}>{c.label}</Chip>)}
              {chips.length > 0 && <button className="text-sm text-slate-500 hover:text-slate-900 hover:underline" onClick={resetAll}>Сбросить всё</button>}
              <span className="ml-auto text-sm text-slate-600">Показано <b>{filtered.length}</b> из {view.length}</span>
              <select className="inp w-auto py-1.5" value={exportAll ? "all" : "filtered"} onChange={(e) => setExportAll(e.target.value === "all")} aria-label="Что выгрузить">
                <option value="filtered">Выгрузить отфильтрованные ({filtered.length})</option>
                <option value="all">Выгрузить все ({view.length})</option>
              </select>
              <button className="btn-sec" onClick={exportExcel}><IconDownload />Скачать в Excel</button>
            </div>

            {/* Таблица */}
            <table className="tbl table-fixed">
              <colgroup><col className="w-8" /><col /><col className="w-44" /><col className="w-16" /><col className="w-36" /><col className="w-24" /><col className="w-36" /><col className="w-32" /></colgroup>
              <thead>
                <tr>
                  <th />
                  <SortTh k="subject" f={f} set={set}>Предмет</SortTh>
                  <SortTh k="region" f={f} set={set}>Регион</SortTh>
                  <th>Ед.</th>
                  <SortTh k="price" f={f} set={set} right>Цена {baseYear}</SortTh>
                  <SortTh k="growth" f={f} set={set} right>Рост</SortTh>
                  <SortTh k="forecast" f={f} set={set} right>Прогноз {baseYear + 1}</SortTh>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="py-10 text-center text-slate-500">
                    Нет позиций по выбранным фильтрам. <button className="text-brand hover:underline" onClick={resetAll}>Сбросить всё</button>
                  </td></tr>
                )}
                {filtered.slice(0, limit).map((v) => {
                  const r = v.row, open = expanded.has(v.id);
                  return (
                    <Fragment key={v.id}>
                      <tr className={`cursor-pointer ${open ? "bg-brand-light/40" : ""}`} onClick={() => toggleRow(v.id)}>
                        <td className="text-slate-400"><span className={`inline-block transition ${open ? "rotate-90" : ""}`}>›</span></td>
                        <td className="break-words">
                          <div className="text-slate-900">{r.subject}</div>
                          <div className="text-xs text-slate-400">{r.okpd2}{r.category ? ` · ${r.category}` : ""}</div>
                        </td>
                        <td className="break-words text-slate-700">{r.regionName ?? r.region ?? "—"}</td>
                        <td className="text-slate-700">{r.unitLabel}</td>
                        <td className="text-right">
                          <div className="whitespace-nowrap">{fmtRub(r.basePrice)}</div>
                          <div className="text-xs text-slate-400">по {r.contracts} {plural(r.contracts, "договору", "договорам", "договорам")}</div>
                        </td>
                        <td className={`whitespace-nowrap text-right ${v.growth < 0 ? "text-red-700" : "text-slate-700"}`}>{fmtGrowth(v.growth)}</td>
                        <td className="whitespace-nowrap text-right text-base font-semibold text-slate-900">{fmtRub(r.forecastPrice)}</td>
                        <td><StatusPill v={v} hidden={hint?.reason ?? null} /></td>
                      </tr>
                      {open && (
                        <tr className="bg-brand-light/40"><td /><td colSpan={7} className="pb-4"><Steps v={v} baseYear={baseYear} sources={reference?.sources ?? []} /></td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > limit && (
              <div className="text-center"><button className="btn-sec" onClick={() => setLimit(limit + PAGE)}>Показать ещё {Math.min(PAGE, filtered.length - limit)} из {filtered.length - limit}</button></div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function numOrNull(s: string): number | null {
  const t = s.replace(",", ".").replace("−", "-").trim();
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
