"use client";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, useReference } from "@/components/useReference";
import { Modal } from "@/components/Modal";
import { IconCheck, IconDownload, IconEdit, IconPlus, IconTrash, IconUpload } from "@/components/Icons";
import { downloadWorkbook, indexTemplate, parseIndexFile, type IndexParseError } from "@/lib/excel";
import {
  COVERAGE_KEY, MONTHS, coefToPercent, formatGrowth, industryLabel, industryName, percentToCoef, type Coverage,
} from "@/lib/indexFormat";
import type { IndexKind, PriceIndex, Reference } from "@/lib/types";
import { findIndex, okvedSection } from "@/lib/forecast";
import { isActiveIndex } from "@/lib/types";
import { MerImportButton } from "@/components/MerImport";
import { RosstatImportButton } from "@/components/RosstatImport";
import { DATA_LINKS, DATA_LINKS_HINT } from "@/lib/sources";
import { lastDataMonth } from "@/lib/logic";

type Tab = { kind: IndexKind; title: string; hint: string; empty: string; extra?: boolean };

const tabsFor = (target: number): Tab[] => [
  { kind: "forecast", title: `Рост цен по отраслям ${target}`, hint: "Ожидаемый рост цен в отрасли на следующий год. Подбирается по коду ОКПД2, а если его нет — по разделу ОКВЭД2.",
    empty: "Отраслевые индексы делают прогноз точнее: цены на стройматериалы, ИТ-услуги или топливо растут по-разному. Без них все позиции считаются по общей инфляции и требуют согласования." },
  { kind: "cpi", title: `Общая инфляция ${target}`, hint: "Применяется к позициям, для которых нет отраслевого индекса. Такие позиции требуют согласования.",
    empty: "Общая инфляция — запасной вариант: она применяется, когда для отрасли нет своего индекса. Без неё такие позиции останутся без пересчёта на следующий год." },
  { kind: "to_december", title: "Перерасчёт цен по месяцам", hint: "Доводит цену договора до уровня последнего месяца с данными Росстата.", extra: true,
    empty: "Договор, заключённый в феврале, отражает февральские цены. Эти индексы поднимают его цену до уровня последнего месяца с данными Росстата, чтобы прогноз не получился заниженным. Если их нет, цена берётся как есть." },
];

function StatusBadge({ approved }: { approved: boolean }) {
  return approved
    ? <span className="inline-flex whitespace-nowrap rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">Утверждено</span>
    : <span className="inline-flex whitespace-nowrap rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">Нужна проверка</span>;
}

/* ---------- Выбор отрасли с поиском по справочникам ОКПД2 и ОКВЭД2 ---------- */
function IndustryPicker({ value, onChange, reference }: { value: string; onChange: (v: string) => void; reference: Reference }) {
  const [q, setQ] = useState(value ? industryLabel(value, reference) : "");
  const [open, setOpen] = useState(false);
  const options = useMemo(() => [
    ...reference.okved2.map((s) => ({ code: s.letter, name: `Раздел ОКВЭД2: ${s.name}` })),
    ...reference.okpd2.map((o) => ({ code: o.code, name: o.name })),
  ], [reference]);
  const needle = q.trim().toLowerCase();
  const hits = needle ? options.filter((o) => o.code.toLowerCase().startsWith(needle) || o.name.toLowerCase().includes(needle)).slice(0, 30) : options.slice(0, 30);
  return (
    <div className="relative">
      <input className="inp py-2" placeholder="Начните вводить код или название, например 43 или строительство" value={q}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQ(e.target.value); setOpen(true);
          const code = e.target.value.trim();
          onChange(/^(\d{2}(\.\d+)*|[A-Za-z])$/.test(code) ? code.toUpperCase() : "");
        }} />
      {open && hits.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {hits.map((o) => (
            <li key={o.code}>
              <button type="button" className="block w-full px-3 py-1.5 text-left text-sm hover:bg-brand-light"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(o.code); setQ(`${o.code} — ${o.name.replace(/^Раздел ОКВЭД2: /, "")}`); setOpen(false); }}>
                <b className="mr-2 text-slate-900">{o.code}</b><span className="text-slate-600">{o.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="hint mt-1">{value ? `Выбрано: ${industryLabel(value, reference)}` : "Можно ввести код, которого нет в справочнике, например 43.21"}</p>
    </div>
  );
}

/* ---------- Окно добавления / редактирования ---------- */
type Draft = { id?: number; key: string; year: number; month: number; percent: string; source_code: string; note: string; approved: boolean };

function IndexForm({ tab, draft, reference, onClose, onSaved }: {
  tab: Tab; draft: Draft; reference: Reference; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const [d, setD] = useState(draft);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Draft>) => setD({ ...d, ...p });
  const needsKey = tab.kind !== "cpi";
  const pct = Number(d.percent.replace(",", ".").replace("−", "-"));

  async function save() {
    if (needsKey && !d.key) return setError("Выберите отрасль");
    if (!d.year) return setError("Укажите год");
    if (d.percent.trim() === "" || !Number.isFinite(pct) || pct <= -100) return setError("Укажите рост в процентах, например 4,5");
    const body = {
      kind: tab.kind, key: needsKey ? d.key : null, year: d.year, month: tab.kind === "to_december" ? d.month : null,
      value: percentToCoef(pct), source_code: d.source_code || null, note: d.note || null, approved: d.approved,
    };
    setBusy(true); setError(null);
    try {
      if (d.id) await api(`/api/dict/price_indices?pk=${d.id}`, "PUT", body);
      else await api("/api/dict/price_indices", "POST", body);
      onSaved(d.id ? "Изменения сохранены" : "Индекс добавлен");
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(/unique|duplicate/i.test(m) ? "Такой индекс уже есть — отредактируйте существующую строку" : m);
      setBusy(false);
    }
  }

  return (
    <Modal title={d.id ? "Изменить индекс" : "Новый индекс"} subtitle={tab.title} onClose={onClose}
      footer={<><button className="btn-sec" onClick={onClose}>Отмена</button><button className="btn" disabled={busy} onClick={save}>{busy ? "Сохранение…" : "Сохранить"}</button></>}>
      {needsKey && (
        <div><span className="field-label">Отрасль (ОКПД2 или раздел ОКВЭД2)</span><IndustryPicker value={d.key} onChange={(key) => set({ key })} reference={reference} /></div>
      )}
      <div className="grid grid-cols-2 gap-4">
        {tab.kind === "to_december" && (
          <div><label className="field-label" htmlFor="f-month">Месяц заключения договора</label>
            <select id="f-month" className="inp py-2" value={d.month} onChange={(e) => set({ month: Number(e.target.value) })}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select></div>
        )}
        <div><label className="field-label" htmlFor="f-year">Год</label>
          <input id="f-year" type="number" className="inp py-2" value={d.year} onChange={(e) => set({ year: Number(e.target.value) })} /></div>
        <div><label className="field-label" htmlFor="f-pct">Рост, %</label>
          <input id="f-pct" className="inp py-2" inputMode="decimal" placeholder="например, 4,5 или −2" value={d.percent} onChange={(e) => set({ percent: e.target.value })} />
          {d.percent.trim() !== "" && Number.isFinite(pct) && <p className="hint mt-1">Цена ×{percentToCoef(pct).toLocaleString("ru-RU", { maximumFractionDigits: 5 })}</p>}
        </div>
      </div>
      <div><label className="field-label" htmlFor="f-src">Источник</label>
        <select id="f-src" className="inp py-2" value={d.source_code} onChange={(e) => set({ source_code: e.target.value })}>
          <option value="">— не указан —</option>
          {reference.sources.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
        </select></div>
      <div><label className="field-label" htmlFor="f-note">Примечание</label>
        <textarea id="f-note" className="inp py-2" rows={2} value={d.note} onChange={(e) => set({ note: e.target.value })} /></div>
      <div><span className="field-label">Статус</span>
        <div className="flex gap-2">
          {[false, true].map((a) => (
            <button key={String(a)} type="button" onClick={() => set({ approved: a })}
              className={`rounded-lg border px-3 py-1.5 text-sm ${d.approved === a ? "border-brand bg-brand-light text-brand" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
              {a ? "Утверждено" : "Нужна проверка"}
            </button>
          ))}
        </div></div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Modal>
  );
}

/* ---------- Где взять данные ---------- */
function DataLinks({ indices }: { indices: PriceIndex[] }) {
  const lastLoad = (codes: string[]) => {
    const ts = indices.filter((i) => i.source_code && codes.includes(i.source_code) && i.loaded_at).map((i) => Date.parse(i.loaded_at!)).filter(Number.isFinite);
    return ts.length ? new Date(Math.max(...ts)).toLocaleDateString("ru-RU") : null;
  };
  const groups: [string, IndexKind][] = [["Рост цен по отраслям и общая инфляция", "forecast"], ["Перерасчёт цен по месяцам", "to_december"]];
  return (
    <div className="space-y-5">
      {groups.map(([title, kind]) => (
        <div key={kind}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
          <ul className="mt-2 space-y-3">
            {DATA_LINKS[kind].map((l) => {
              const d = lastLoad(l.sourceCodes);
              return (
                <li key={l.url} className="text-sm">
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand hover:underline">{l.title} ↗</a>
                  <span className="ml-2 text-xs text-slate-500">{d ? `последняя загрузка ${d}` : "ещё не загружали"}</span>
                  <p className="text-xs text-slate-600">{l.description}</p>
                  <p className={`mt-0.5 text-xs ${l.file ? "text-slate-500" : "text-amber-800"}`}>{l.file ? "Как загрузить: " : "Важно: "}{l.howTo}</p>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <p className="hint">{DATA_LINKS_HINT}</p>
    </div>
  );
}

/* ---------- Кнопка загрузки файла ---------- */
function UploadButton({ busy, onFile, primary }: { busy: boolean; onFile: (f: File) => void; primary?: boolean }) {
  return (
    <label className={`${primary ? "btn" : "btn-sec"} cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`}><IconUpload />Загрузить из Excel
      <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
    </label>
  );
}

/* ---------- Страница ---------- */
type UploadReport = { inserted: number; updated: number; errors: IndexParseError[]; fatal?: string };

export default function IndicesPage() {
  const { db, reference, reload, error } = useReference();
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  useEffect(() => {
    try { const raw = localStorage.getItem(COVERAGE_KEY); if (raw) setCoverage(JSON.parse(raw)); } catch { /* недоступно */ }
  }, []);
  const target = coverage?.targetYear ?? new Date().getFullYear() + 1;
  const tabs = tabsFor(target);
  const [tabKind, setTabKind] = useState<IndexKind>("forecast");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "forecast" || t === "cpi" || t === "to_december") setTabKind(t);
  }, []);
  const tab = tabs.find((t) => t.kind === tabKind)!;
  const [onlyPending, setOnlyPending] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [form, setForm] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [report, setReport] = useState<UploadReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canEdit = db === true;

  // Заменённые версии не показываем; новые версии, ждущие проверки, — рядом с действующими
  const indices = useMemo(() => (reference?.indices ?? []).filter((i) => !i.superseded_at), [reference]);
  const activeIndices = useMemo(() => indices.filter(isActiveIndex), [indices]);
  const pendingTotal = indices.filter((i) => !i.approved).length;
  // Индексы разных лет не смешиваем: по умолчанию — год текущего расчёта
  const [yearSel, setYearSel] = useState<number | null>(null);
  const defYear = (k: IndexKind) => (k === "to_december" ? target - 1 : target);
  const yearsOf = (k: IndexKind) => [...new Set(indices.filter((i) => i.kind === k).map((i) => i.year))].sort((a, b) => b - a);
  const years = yearsOf(tabKind);
  const yearOf = (k: IndexKind, sel: number | null) => {
    const ys = yearsOf(k);
    return sel != null && ys.includes(sel) ? sel : ys.includes(defYear(k)) ? defYear(k) : ys[0] ?? defYear(k);
  };
  const year = yearOf(tabKind, yearSel);
  const lastMonth = lastDataMonth(indices, year);
  const rows = indices
    .filter((i) => i.kind === tabKind && i.year === year && (!onlyPending || !i.approved))
    .sort((a, b) => b.year - a.year || (a.key ?? "").localeCompare(b.key ?? "", "ru", { numeric: true }) || (a.month ?? 0) - (b.month ?? 0)
      || (a.pending_of ? 1 : 0) - (b.pending_of ? 1 : 0));
  const sourceOf = (code: string | null) => (code ? reference?.sources.find((s) => s.code === code) : undefined);
  // Пересчёт по месяцам: индексы одной отрасли — одной строкой с раскрытием
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleGroup = (k: string) => setExpanded((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  // Раздел (две цифры) → коды внутри него → месяцы
  const divisions: { div: string; groups: { key: string; items: PriceIndex[] }[] }[] = [];
  if (tabKind === "to_december") {
    const byKey = new Map<string, PriceIndex[]>();
    for (const ix of rows) { const k = ix.key ?? ""; byKey.get(k)?.push(ix) ?? byKey.set(k, [ix]); }
    for (const [key, items] of byKey) {
      const div = /^\d{2}/.test(key) ? key.slice(0, 2) : key;
      const d = divisions.find((x) => x.div === div) ?? (divisions.push({ div, groups: [] }), divisions[divisions.length - 1]);
      d.groups.push({ key, items });
    }
    // Сначала весь раздел, затем подгруппы по порядку
    for (const d of divisions) d.groups.sort((a, b) => (a.key === d.div ? -1 : b.key === d.div ? 1 : a.key.localeCompare(b.key, "ru", { numeric: true })));
  }
  const pad = (depth: number) => ({ paddingLeft: `${0.75 + depth * 1.5}rem` });
  const summaryRow = (key: string, items: PriceIndex[], depth: number, open: boolean, label: ReactNode, count: string) => {
    const vals = items.map((i) => i.value);
    const pending = items.filter((i) => !i.approved);
    const src = sourceOf(items[0].source_code);
    const ids = items.map((i) => i.id);
    const allSel = ids.every((id) => selected.has(id));
    return (
      <tr key={key} className={`cursor-pointer hover:bg-slate-50 ${depth ? "bg-slate-50/50" : ""}`} onClick={() => toggleGroup(key)}>
        {canEdit && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={allSel} onChange={() => {
          const s = new Set(selected); ids.forEach((id) => (allSel ? s.delete(id) : s.add(id))); setSelected(s);
        }} /></td>}
        <td style={pad(depth)}><div className="flex items-start"><span className={`mr-2 inline-block shrink-0 leading-5 text-slate-400 transition ${open ? "rotate-90" : ""}`}>›</span><div className={depth ? "text-slate-700" : ""}>{label}</div></div></td>
        <td className="whitespace-nowrap text-slate-600">{count}</td>
        <td>{items[0].year}</td>
        <td className="whitespace-nowrap text-right font-medium text-slate-900">{formatGrowth(Math.min(...vals))} … {formatGrowth(Math.max(...vals))}</td>
        <td>{depth ? null : src ? <a href={src.url} target="_blank" rel="noreferrer" className="text-brand hover:underline" onClick={(e) => e.stopPropagation()}>{src.name}</a> : items[0].source_code ?? <span className="text-slate-400">не указан</span>}</td>
        <td>{pending.length
          ? <span className="inline-flex whitespace-nowrap rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">Ждут проверки: {pending.length}</span>
          : <StatusBadge approved />}</td>
        <td className="text-xs text-slate-600">{!depth && lastMonth ? `Пересчёт до уровня: ${MONTHS[lastMonth - 1]} ${year}` : ""}</td>
        {canEdit && (
          <td className="whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
            {pending.length > 0 && <button className="btn-sec !px-2.5 !py-1" disabled={busy} onClick={() => approve(pending.map((i) => i.id))}>Утвердить все</button>}
          </td>
        )}
      </tr>
    );
  };
  const renderGroup = (g: { key: string; items: PriceIndex[] }, depth: number, label: ReactNode) => {
    if (g.items.length === 1 && !depth) return renderRow(g.items[0]);
    const open = expanded.has(g.key);
    return (
      <Fragment key={g.key}>
        {summaryRow(g.key, g.items, depth, open, label, `${g.items.length} ${plural(g.items.length, "месяц", "месяца", "месяцев")}`)}
        {open && g.items.map((ix) => renderRow(ix, true))}
      </Fragment>
    );
  };
  const renderRow = (ix: PriceIndex, nested = false) => {
    const src = sourceOf(ix.source_code);
    return (
                  <tr key={ix.id} className={nested ? "bg-slate-50/60" : ""}>
                    {canEdit && <td><input type="checkbox" checked={selected.has(ix.id)} onChange={() => {
                      const s = new Set(selected); if (s.has(ix.id)) s.delete(ix.id); else s.add(ix.id); setSelected(s);
                    }} /></td>}
                    {tab.kind !== "cpi" && <td className={nested ? "text-slate-500" : ""}>{nested ? "" : reference ? industryLabel(ix.key, reference) : ix.key}</td>}
                    {tab.kind === "to_december" && <td>{ix.month ? MONTHS[ix.month - 1] : "—"}</td>}
                    <td>{ix.year}</td>
                    <td className={`whitespace-nowrap text-right font-medium ${ix.value < 1 ? "text-red-700" : "text-slate-900"}`}>{formatGrowth(ix.value)}</td>
                    <td>{src ? <a href={src.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">{src.name}</a> : ix.source_code ?? <span className="text-slate-400">не указан</span>}</td>
                    <td>
                      {ix.pending_of ? <span className="inline-flex whitespace-nowrap rounded-md bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800 ring-1 ring-sky-200">Новая версия</span> : <StatusBadge approved={ix.approved} />}
                      {ix.change_note && <p className="mt-1 text-xs text-slate-500">{ix.change_note}</p>}
                    </td>
                    <td className="max-w-xs text-xs text-slate-600">
                      {ix.note && <p>{ix.note}</p>}
                      {ix.doc_title && <p title={ix.raw_line ?? undefined} className="cursor-help">
                        {ix.indicator === "icp" ? "ИЦП" : ix.indicator === "deflator" ? "Дефлятор" : ""}{ix.indicator ? " · " : ""}
                        {ix.doc_title}{ix.doc_date ? `, одобрен ${ix.doc_date}` : ""}{ix.doc_page ? `, ${ix.doc_page}` : ""}
                        {ix.ref_deflator ? ` · дефлятор справочно ${formatGrowth(ix.ref_deflator)}` : ""}
                      </p>}
                    </td>
                    {canEdit && (
                      <td className="whitespace-nowrap text-right">
                        {!ix.approved && <button className="btn-sec mr-1 !px-2.5 !py-1" disabled={busy} onClick={() => approve([ix.id])}>Утвердить</button>}
                        <button className="btn-icon mr-1" title="Изменить" onClick={() => openEdit(ix)}><IconEdit width={16} height={16} /></button>
                        <button className="btn-icon" title="Удалить" onClick={() => remove(ix)}><IconTrash width={16} height={16} /></button>
                      </td>
                    )}
                  </tr>
    );
  };

  useEffect(() => setSelected(new Set()), [tabKind, onlyPending, year]);

  async function approve(ids: number[]) {
    setBusy(true);
    try {
      await api("/api/indices/approve", "POST", { ids });
      setMsg(ids.length === 1 ? "Индекс утверждён" : `Утверждено индексов: ${ids.length}`);
      setSelected(new Set());
      await reload();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }

  async function remove(ix: PriceIndex) {
    if (!confirm("Удалить индекс?")) return;
    try { await api(`/api/dict/price_indices?pk=${ix.id}`, "DELETE"); setMsg("Индекс удалён"); await reload(); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  }

  async function upload(f: File) {
    if (!reference) return;
    setBusy(true); setReport(null); setMsg(null);
    const { rows: parsed, errors } = parseIndexFile(await f.arrayBuffer(), reference.sources);
    try {
      const r = parsed.length ? await api("/api/dict/price_indices/bulk", "POST", { rows: parsed }) : { inserted: 0, updated: 0 };
      setReport({ inserted: r.inserted, updated: r.updated, errors });
      await reload();
    } catch (e) {
      setReport({ inserted: 0, updated: 0, errors, fatal: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
  }

  // После загрузки прогноза МЭР — на вкладку отраслевых индексов, к значениям, ждущим проверки
  async function afterMer(m: string) {
    setNotice(m);
    await reload();
    setTabKind("forecast");
    setOnlyPending(true);
  }

  async function afterRosstat(m: string) {
    setNotice(m);
    await reload();
    setTabKind("to_december");
    setOnlyPending(true);
  }

  const openNew = (kind: IndexKind = tabKind, key = "") =>
    setForm({ key, year: kind === "to_december" ? target - 1 : target, month: 1, percent: "", source_code: "", note: "", approved: false });
  const openEdit = (ix: PriceIndex) => setForm({
    id: ix.id, key: ix.key ?? "", year: ix.year, month: ix.month ?? 1, percent: String(coefToPercent(ix.value)).replace(".", ","),
    source_code: ix.source_code ?? "", note: ix.note ?? "", approved: ix.approved,
  });
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="space-y-4">
      <div className="card space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold text-slate-900">Индексы роста цен</h1>
          <button className="text-sm font-medium text-brand hover:underline" onClick={() => setShowSources(true)}>Где взять данные</button>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="hint">На сколько процентов вырастут цены в следующем году. По этим данным рассчитывается прогноз цен.</p>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && reference && <MerImportButton reference={reference} targetYear={target} disabled={busy} onDone={afterMer} />}
            {canEdit && reference && <RosstatImportButton reference={reference} baseYear={target - 1} disabled={busy} onDone={afterRosstat} />}
            {canEdit && <UploadButton busy={busy} onFile={upload} />}
            <button className="btn-sec" disabled={!reference} onClick={() => reference && downloadWorkbook(indexTemplate(indices, reference.sources), "Индексы роста цен.xlsx")}><IconDownload />Скачать в Excel</button>
          </div>
        </div>
        {notice && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <span>{notice}</span>
            <button className="text-emerald-700 hover:underline" onClick={() => setNotice(null)}>Скрыть</button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button className="text-brand underline-offset-2 hover:underline" onClick={() => downloadWorkbook(indexTemplate([], reference?.sources), "Шаблон индексов.xlsx")}>Скачать шаблон</button>
          {db === false && <span className="text-amber-700">База данных не подключена — индексы доступны только для просмотра.</span>}
          {error && <span className="text-red-600">{error}</span>}
        </div>

        {report && (
          <div className={`rounded-lg border p-4 text-sm ${report.fatal || report.errors.length ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
            <div className="flex items-start justify-between gap-4">
              <p className="font-medium text-slate-900">
                {report.fatal ? "Файл не загружен" : `Загрузка завершена: добавлено ${report.inserted}, обновлено ${report.updated}`}
                {report.errors.length > 0 && `, строк с ошибками — ${report.errors.length}`}
              </p>
              <button className="text-slate-500 hover:text-slate-800" onClick={() => setReport(null)}>Скрыть</button>
            </div>
            {report.fatal && <p className="mt-1 text-red-700">{report.fatal}</p>}
            {report.errors.length > 0 && (
              <ul className="mt-2 max-h-48 space-y-0.5 overflow-auto text-slate-700">
                {report.errors.map((e) => <li key={e.line}>Строка {e.line}: {e.message}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>

      {coverage && coverage.total > 0 && (
        <div className="card py-4">
          <p className="text-sm font-semibold text-slate-900">Покрытие прогноза</p>
          <p className="mt-1 text-sm text-slate-700">
            Из {coverage.total} {plural(coverage.total, "позиции", "позиций", "позиций")} прогноза:{" "}
            <b className="text-emerald-700">{coverage.industry}</b> — отраслевой индекс,{" "}
            <b className="text-amber-700">{coverage.cpi}</b> — общая инфляция (требуют согласования),{" "}
            <b className="text-red-700">{coverage.none}</b> — без индекса.
          </p>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="bg-emerald-500" style={{ width: `${(coverage.industry / coverage.total) * 100}%` }} />
            <div className="bg-amber-400" style={{ width: `${(coverage.cpi / coverage.total) * 100}%` }} />
            <div className="bg-red-400" style={{ width: `${(coverage.none / coverage.total) * 100}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="hint">По последнему расчёту прогноза от {new Date(coverage.at).toLocaleString("ru-RU")}.</p>
            {(coverage.missing?.length ?? 0) > 0 && (
              <button className="text-sm font-medium text-brand hover:underline" onClick={() => setShowMissing(!showMissing)}>
                {showMissing ? "Скрыть список" : "Показать позиции без отраслевого индекса"}
              </button>
            )}
          </div>
          {showMissing && coverage.missing && (
            <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-slate-200">
              <table className="tbl">
                <thead><tr><th>Код ОКПД2</th><th>Наименование</th><th className="text-right">Позиций</th><th className="w-48" /></tr></thead>
                <tbody>
                  {coverage.missing.map((m) => {
                    const added = reference ? findIndex(activeIndices.filter((i) => i.kind === "forecast" && i.year === coverage.targetYear), m.okpd2, okvedSection(m.okpd2, reference)) : null;
                    return (
                      <tr key={m.okpd2}>
                        <td className="whitespace-nowrap font-medium">{m.okpd2}</td>
                        <td>{m.name || (reference && industryName(m.okpd2.slice(0, 2), reference)) || "—"}</td>
                        <td className="text-right">{m.positions}</td>
                        <td className="text-right">
                          {added ? <span className="text-xs text-emerald-700">индекс добавлен — пересчитайте прогноз</span>
                            : canEdit && <button className="btn-sec !px-2.5 !py-1" onClick={() => { setTabKind("forecast"); setOnlyPending(false); openNew("forecast", m.okpd2); }}><IconPlus width={14} height={14} />Добавить индекс</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="card space-y-4">
        {pendingTotal > 0 && (
          <button onClick={() => {
            const next = !onlyPending; setOnlyPending(next);
            if (next && !indices.some((i) => i.kind === tabKind && !i.approved)) setTabKind(indices.find((i) => !i.approved)!.kind);
          }} className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition ${onlyPending ? "bg-amber-100 text-amber-900 ring-amber-300" : "bg-amber-50 text-amber-800 ring-amber-200 hover:bg-amber-100"}`}>
            {pendingTotal} {plural(pendingTotal, "индекс ждёт", "индекса ждут", "индексов ждут")} проверки
            <span className="text-xs font-normal">{onlyPending ? "· показать все" : "· показать"}</span>
          </button>
        )}

        <div className="flex flex-wrap gap-1 border-b border-slate-200">
          {tabs.map((t) => {
            const list = indices.filter((i) => i.kind === t.kind && i.year === yearOf(t.kind, null) && (!onlyPending || !i.approved));
            // По месяцам считаем отрасли, а не строки
            const n = t.kind === "to_december" ? new Set(list.map((i) => i.key)).size : list.length;
            return (
              <button key={t.kind} onClick={() => { setTabKind(t.kind); setYearSel(null); }}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${t.kind === tabKind ? "border-brand text-brand" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
                {t.title}
                {t.extra && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-500">доп. настройка</span>}
                <span className="ml-2 text-xs text-slate-400">{n}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <p className="hint max-w-3xl">{tabKind === "to_december" && lastMonth
              ? `Доводит цену договора до уровня последнего месяца с данными Росстата (сейчас — ${MONTHS[lastMonth - 1]} ${year}).`
              : tab.hint}{tabKind === "to_december" && " Если у раздела есть подгруппы, позиции с кодом подгруппы считаются по её индексу, остальные — по индексу всего раздела."}</p>
            {years.length > 1 && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-600">Год:</span>
                {years.map((y) => (
                  <button key={y} type="button" onClick={() => setYearSel(y)}
                    className={`rounded-lg border px-3 py-1 ${y === year ? "border-brand bg-brand-light text-brand" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                    {y} <span className="text-xs text-slate-400">{indices.filter((i) => i.kind === tabKind && i.year === y && (!onlyPending || !i.approved)).length}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {canEdit && (
            <div className="flex gap-2">
              {selected.size > 0 && <button className="btn-sec" disabled={busy} onClick={() => approve([...selected])}><IconCheck width={16} height={16} />Утвердить выбранные ({selected.size})</button>}
              {rows.length > 0 && <button className="btn" onClick={() => openNew()}><IconPlus width={16} height={16} />Добавить индекс</button>}
            </div>
          )}
        </div>
        {msg && <p className="text-sm text-slate-700">{msg}</p>}

        {rows.length === 0 && !onlyPending ? (
          <div className="rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center">
            <p className="font-medium text-slate-900">Индексов пока нет</p>
            <p className="hint mx-auto mt-1 max-w-2xl">{tab.empty}</p>
            <button className="mt-2 text-sm text-brand hover:underline" onClick={() => setShowSources(true)}>Где взять данные</button>
            {canEdit ? (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button className="btn" onClick={() => openNew()}><IconPlus width={16} height={16} />Добавить</button>
                {tabKind !== "to_december" && reference && <MerImportButton reference={reference} targetYear={target} disabled={busy} onDone={afterMer} />}
                {tabKind === "to_december" && reference && <RosstatImportButton reference={reference} baseYear={target - 1} disabled={busy} onDone={afterRosstat} />}
                <UploadButton busy={busy} onFile={upload} />
              </div>
            ) : db === false && <p className="mt-3 text-sm text-amber-700">Чтобы добавлять индексы, подключите базу данных.</p>}
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                {canEdit && <th className="w-8"><input type="checkbox" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))} /></th>}
                {tab.kind !== "cpi" && <th>Отрасль</th>}
                {tab.kind === "to_december" && <th>Месяц договора</th>}
                <th>Год</th>
                <th className="text-right">Рост</th>
                <th>Источник</th>
                <th>Статус</th>
                <th>Примечание</th>
                {canEdit && <th className="w-40" />}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={9} className="py-8 text-center text-slate-500">На этой вкладке нет индексов, ждущих проверки</td></tr>
              )}
              {tabKind !== "to_december" ? rows.map((ix) => renderRow(ix)) : divisions.map((d) => {
                // Один код в разделе — без лишнего уровня
                if (d.groups.length === 1) return renderGroup(d.groups[0], 0, reference ? industryLabel(d.groups[0].key, reference) : d.groups[0].key);
                const all = d.groups.flatMap((g) => g.items);
                const open = expanded.has(`d:${d.div}`);
                const subs = d.groups.filter((g) => g.key !== d.div).length;
                return (
                  <Fragment key={`d:${d.div}`}>
                    {summaryRow(`d:${d.div}`, all, 0, open,
                      <>{reference ? industryLabel(d.div, reference) : d.div}<span className="mt-0.5 block text-xs text-slate-500">
                        {d.groups.some((g) => g.key === d.div) ? "весь раздел и " : ""}{subs} {plural(subs, "подгруппа", "подгруппы", "подгрупп")}</span></>,
                      `${d.groups.length} ${plural(d.groups.length, "индекс", "индекса", "индексов")}`)}
                    {open && d.groups.map((g) => renderGroup(g, 1, g.key === d.div ? `Весь раздел ${g.key}` : reference ? `Подгруппа ${industryLabel(g.key, reference)}` : g.key))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {showSources && (
        <Modal title="Где взять данные" onClose={() => setShowSources(false)}
          footer={<button className="btn" onClick={() => setShowSources(false)}>Понятно</button>}>
          <DataLinks indices={indices} />
        </Modal>
      )}
      {form && reference && (
        <IndexForm tab={tab} draft={form} reference={reference} onClose={() => setForm(null)}
          onSaved={async (m) => { setForm(null); setMsg(m); await reload(); }} />
      )}
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
