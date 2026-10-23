"use client";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, useReference } from "@/components/useReference";
import { Modal } from "@/components/Modal";
import { IconCheck, IconDownload, IconEdit, IconPlus, IconTrash, IconUpload } from "@/components/Icons";
import { downloadWorkbook, indexTemplate, parseIndexFile, type IndexParseError } from "@/lib/excel";
import {
  COVERAGE_KEY, KEY_TITLE, MONTHS, keyType, coefToPercent, formatGrowth, industryLabel, industryName, percentToCoef, type Coverage,
} from "@/lib/indexFormat";
import { SCENARIO_KINDS, consKind, type IndexKind, type PriceIndex, type Reference, type ScenarioKind } from "@/lib/types";
import { findIndex, okvedSection } from "@/lib/forecast";
import { isActiveIndex } from "@/lib/types";
import { MerImportButton } from "@/components/MerImport";
import { RosstatImportButton } from "@/components/RosstatImport";
import { MinstroyHowTo, MinstroyImportButton } from "@/components/MinstroyImport";
import { DATA_LINKS, DATA_LINKS_HINT } from "@/lib/sources";
import { lastDataMonth } from "@/lib/logic";
import { CbrField } from "@/components/DataRefresh";
import { staleness, type FreshId } from "@/lib/freshness";

type Tab = { kind: IndexKind; short: string; title: string; hint: string; empty: string; extra?: boolean };

const tabsFor = (target: number): Tab[] => [
  { kind: "forecast", short: "Отрасли", title: `Рост цен по отраслям ${target}`, hint: "Ожидаемый рост цен в отрасли на следующий год. Подбирается по коду ОКПД2, а если его нет — по разделу ОКВЭД2.",
    empty: "Отраслевые индексы делают прогноз точнее: цены на стройматериалы, ИТ-услуги или топливо растут по-разному. Без них все позиции считаются по общей инфляции и требуют согласования." },
  { kind: "cpi", short: "Инфляция", title: `Общая инфляция ${target}`, hint: "Применяется к позициям, для которых нет отраслевого индекса. Такие позиции требуют согласования.",
    empty: "Общая инфляция — запасной вариант: она применяется, когда для отрасли нет своего индекса. Без неё такие позиции останутся без пересчёта на следующий год." },
  { kind: "wage", short: "Зарплаты", title: `Рост зарплат ${target}`, hint: "Для трудоёмких услуг — охрана (80), уборка (81.2), питание (56), обучение (85): основная часть их цены — зарплата персонала, а она растёт не так, как потребительские цены.",
    empty: "Без прогноза зарплат трудоёмкие услуги считаются по отраслевому индексу или общей инфляции — рост может быть занижен." },
  { kind: "fx", short: "Курс валют", title: `Курс валют ${target}`, hint: "Для договоров в валюте (колонка «Наименование валюты» в отчётности): цена в рублях следует за курсом. Код — USD, EUR или CNY; если нужной валюты нет, берётся доллар.",
    empty: "Без прогноза курса валютные договоры считаются как рублёвые." },
  { kind: "minstroy", short: "Стройка по регионам", title: "Стройка по регионам", hint: "Индексы изменения сметной стоимости Минстроя по субъектам РФ. Применяются к строительству и проектированию (ОКПД2 41, 42, 43, 71.1) в своём регионе вместо общего индекса «Строительство».",
    empty: "Строительство — самая крупная часть ГПЗ. Без региональных индексов Минстроя оно считается по общему индексу для всей страны." },
  { kind: "to_december", short: "Пересчёт по месяцам", title: "Перерасчёт цен по месяцам", hint: "Доводит цену договора до уровня последнего месяца с данными Росстата.", extra: true,
    empty: "Договор, заключённый в феврале, отражает февральские цены. Эти индексы поднимают его цену до уровня последнего месяца с данными Росстата, чтобы прогноз не получился заниженным. Если их нет, цена берётся как есть." },
];

/** Источники данных — карточки вверху раздела */
const SOURCES: { id: FreshId; title: string; what: string; tab: IndexKind; match: (i: PriceIndex) => boolean }[] = [
  { id: "mer", title: "Минэкономразвития", what: "Рост цен по отраслям, зарплаты и курс доллара. Раз в год, в сентябре.", tab: "forecast",
    match: (i) => /^(forecast|wage|fx)/.test(i.kind) || (/^cpi/.test(i.kind) && i.source_code !== "CBR") },
  { id: "cbr", title: "Банк России", what: "Прогноз инфляции — для позиций без отраслевого индекса. Сверять раз в месяц.", tab: "cpi",
    match: (i) => i.kind === "cpi" && i.source_code === "CBR" },
  { id: "rosstat", title: "Росстат", what: "Рост цен внутри года: доводит цену договора до последнего месяца. Ежемесячно.", tab: "to_december",
    match: (i) => i.kind === "to_december" },
  { id: "minstroy", title: "Минстрой (ФГИС ЦС)", what: "Стройка по регионам. Раз в квартал.", tab: "minstroy",
    match: (i) => i.kind === "minstroy" },
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
  const kt = keyType(tab.kind);
  const needsKey = kt !== "none";
  const pct = Number(d.percent.replace(",", ".").replace("−", "-"));

  async function save() {
    if (needsKey && !d.key) return setError(kt === "currency" ? "Выберите валюту" : kt === "region" ? "Выберите регион" : "Выберите отрасль");
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
      {kt === "industry" && (
        <div><span className="field-label">Отрасль (ОКПД2 или раздел ОКВЭД2)</span><IndustryPicker value={d.key} onChange={(key) => set({ key })} reference={reference} /></div>
      )}
      {kt === "currency" && (
        <div><label className="field-label" htmlFor="f-cur">Валюта</label>
          <select id="f-cur" className="inp py-2" value={d.key} onChange={(e) => set({ key: e.target.value })}>
            <option value="">— выберите —</option>{[["USD", "Доллар США"], ["EUR", "Евро"], ["CNY", "Юань"]].map(([c, n]) => <option key={c} value={c}>{c} — {n}</option>)}
          </select></div>
      )}
      {kt === "region" && (
        <div><label className="field-label" htmlFor="f-reg">Регион</label>
          <select id="f-reg" className="inp py-2" value={d.key} onChange={(e) => set({ key: e.target.value })}>
            <option value="">— выберите —</option>
            {[...reference.regions].sort((a, b) => a.name.localeCompare(b.name, "ru")).map((r) => <option key={r.code} value={r.code}>{r.name} ({r.code})</option>)}
          </select></div>
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
  const groups: [string, IndexKind][] = [["Рост цен по отраслям и общая инфляция (базовый и консервативный)", "forecast"], ["Рост зарплат", "wage"], ["Курс валют", "fx"],
    ["Стройка по регионам (Минстрой)", "minstroy"], ["Перерасчёт цен по месяцам", "to_december"]];
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
  // Год прогноза — общий для всех вкладок и загрузок; индексы прошлых лет остаются в архиве
  const thisTarget = new Date().getFullYear() + 1;
  const [targetSel, setTargetSel] = useState<number | null>(null);
  const target = targetSel ?? coverage?.targetYear ?? thisTarget;
  const tabs = tabsFor(target);
  const [tabKind, setTabKind] = useState<IndexKind>("forecast");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && ["forecast", "cpi", "wage", "fx", "minstroy", "to_december"].includes(t)) setTabKind(t as IndexKind);
  }, []);
  // Консервативный сценарий МЭР — те же вкладки, свой вид индекса
  const hasScenario = (SCENARIO_KINDS as IndexKind[]).includes(tabKind);
  const kind: IndexKind = tabKind;
  const tab0 = tabs.find((t) => t.kind === tabKind)!;
  const tab = { ...tab0, kind, title: tab0.title };
  const kt = keyType(kind);
  const [onlyPending, setOnlyPending] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [form, setForm] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [report, setReport] = useState<UploadReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canEdit = db === true;

  // Заменённые версии не показываем; новые версии, ждущие проверки, — рядом с действующими
  const indices = useMemo(() => (reference?.indices ?? []).filter((i) => !i.superseded_at), [reference]);
  const activeIndices = useMemo(() => indices.filter(isActiveIndex), [indices]);
  const pendingTotal = indices.filter((i) => !i.approved).length;
  // Индексы разных лет не смешиваем: по умолчанию — год текущего расчёта
  const defYear = (k: IndexKind) => (k === "to_december" ? target - 1 : target);
  // Годы прогноза, по которым есть индексы (пересчёт по месяцам относится к году базы — прогноз на следующий)
  const targetYears = [...new Set([thisTarget, target, ...indices.map((i) => (i.kind === "to_december" ? i.year + 1 : i.year))])].sort((a, b) => b - a);
  const yearOf = (k: IndexKind, _sel: number | null) => defYear(k);
  const year = defYear(kind);
  const lastMonth = lastDataMonth(indices, year);
  const stale = staleness(indices, target, target - 1);
  const rows = indices
    .filter((i) => i.kind === kind && i.year === year && (!onlyPending || !i.approved
      || (hasScenario && indices.some((o) => o.kind === consKind(kind as ScenarioKind) && !o.approved && (o.key ?? null) === (i.key ?? null) && o.year === i.year))))
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
    const ids = items.map((i) => i.id);
    const allSel = ids.every((id) => selected.has(id));
    return (
      <tr key={key} className={`cursor-pointer hover:bg-slate-50 ${depth ? "bg-slate-50/50" : ""}`} onClick={() => toggleGroup(key)}>
        {canEdit && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={allSel} onChange={() => {
          const s = new Set(selected); ids.forEach((id) => (allSel ? s.delete(id) : s.add(id))); setSelected(s);
        }} /></td>}
        <td style={pad(depth)}><div className="flex items-start"><span className={`mr-2 inline-block shrink-0 leading-5 text-slate-400 transition ${open ? "rotate-90" : ""}`}>›</span><div className={depth ? "text-slate-700" : ""}>{label}</div></div></td>
        <td className="whitespace-nowrap text-slate-600">{count}</td>
        <td className="whitespace-nowrap text-right font-medium text-slate-900">{formatGrowth(Math.min(...vals))} … {formatGrowth(Math.max(...vals))}</td>
        <td>{pending.length
          ? <span className="inline-flex whitespace-nowrap rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">Ждут проверки: {pending.length}</span>
          : <StatusBadge approved />}</td>
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
  // Рост по отраслям: раздел ОКВЭД2 (буква) → виды продукции по кодам ОКПД2 (цифры)
  const colCount = (canEdit ? 2 : 0) + (kt !== "none" ? 1 : 0) + (tab.kind === "to_december" ? 1 : 0) + 2;
  const divOf = (k: string | null) => (k && /^\d{2}/.test(k) ? Number(k.slice(0, 2)) : null);
  const sections = tabKind === "forecast" && reference
    ? reference.okved2.map((sec) => ({
      sec,
      own: rows.filter((r) => r.key === sec.letter),
      subs: rows.filter((r) => { const d = divOf(r.key); return d != null && d >= sec.div_from && d <= sec.div_to; })
        .sort((a, b) => (a.key ?? "").localeCompare(b.key ?? "", "ru", { numeric: true })),
    })).filter((x) => x.own.length || x.subs.length)
    : [];
  const placed = new Set(sections.flatMap((x) => [...x.own, ...x.subs].map((r) => r.id)));
  const unsectioned = tabKind === "forecast" ? rows.filter((r) => !placed.has(r.id)) : [];
  const renderRow = (ix: PriceIndex, nested = false, label?: ReactNode) => {
    const src = sourceOf(ix.source_code);
    // Консервативный сценарий — вторым числом в той же строке
    const twin = hasScenario ? indices.find((o) => o.kind === consKind(tabKind as ScenarioKind) && (o.key ?? null) === (ix.key ?? null) && o.year === ix.year && !o.pending_of) : undefined;
    const ids = [ix.id, ...(twin && !twin.approved ? [twin.id] : [])];
    return (
                  <tr key={ix.id} className={nested ? "bg-slate-50/60" : ""}>
                    {canEdit && <td><input type="checkbox" checked={selected.has(ix.id)} onChange={() => {
                      const s = new Set(selected); if (s.has(ix.id)) s.delete(ix.id); else s.add(ix.id); setSelected(s);
                    }} /></td>}
                    {kt !== "none" && <td className={nested ? "text-slate-500" : ""}>{label ?? (nested ? "" : kt === "currency" ? ix.key : kt === "region" ? `${reference?.regions.find((r) => r.code === ix.key)?.name ?? ""} (${ix.key})` : reference ? industryLabel(ix.key, reference) : ix.key)}</td>}
                    {tab.kind === "to_december" && <td>{ix.month ? MONTHS[ix.month - 1] : "—"}</td>}
                    <td className="whitespace-nowrap text-right" title={[src?.name ?? ix.source_code, ix.doc_title && `${ix.doc_title}${ix.doc_date ? `, одобрен ${ix.doc_date}` : ""}${ix.doc_page ? `, ${ix.doc_page}` : ""}`, ix.note].filter(Boolean).join("\n")}>
                      <span className={`cursor-help font-medium ${ix.value < 1 ? "text-red-700" : "text-slate-900"}`}>{formatGrowth(ix.value)}</span>
                      {twin && <span className="block text-xs text-slate-500">конс. {formatGrowth(twin.value)}</span>}
                    </td>
                    <td>
                      {ix.pending_of ? <span className="inline-flex whitespace-nowrap rounded-md bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800 ring-1 ring-sky-200">Новая версия</span> : <StatusBadge approved={ix.approved} />}
                      {ix.change_note && <p className="mt-1 text-xs text-slate-500">{ix.change_note}</p>}
                      {twin && !twin.approved && <p className="mt-1 text-xs text-amber-700">конс. ждёт проверки</p>}
                    </td>
                    {canEdit && (
                      <td className="whitespace-nowrap text-right">
                        {(!ix.approved || ids.length > 1) && <button className="btn-sec mr-1 !px-2.5 !py-1" disabled={busy} onClick={() => approve(ids)}>Утвердить</button>}
                        <button className="btn-icon mr-1" title="Изменить" onClick={() => openEdit(ix)}><IconEdit width={16} height={16} /></button>
                        <button className="btn-icon" title="Удалить" onClick={() => remove(ix)}><IconTrash width={16} height={16} /></button>
                      </td>
                    )}
                  </tr>
    );
  };

  useEffect(() => setSelected(new Set()), [kind, onlyPending, year]);
  // На узком экране выбранная вкладка может оказаться за краем — прокручиваем её в видимую часть
  useEffect(() => { document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [tabKind]);

  async function approve(ids: number[]) {
    setBusy(true);
    try {
      await api("/api/indices/approve", "POST", { ids });
      // Включён фильтр «ждут проверки» и на вкладке больше нечего проверять — показываем все, иначе утверждённые «пропадают»
      const left = rows.filter((r) => !r.approved && !ids.includes(r.id));
      if (onlyPending && !left.length) setOnlyPending(false);
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

  async function afterMinstroy(m: string) {
    setNotice(m);
    await reload();
    setTabKind("minstroy");
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold text-slate-900">Данные для прогноза на</h1>
            <select aria-label="Год прогноза" className="inp w-auto py-1 text-lg font-semibold" value={target} onChange={(e) => setTargetSel(Number(e.target.value))}>
              {[...new Set([...targetYears, ...Array.from({ length: thisTarget + 3 - 2015 }, (_, i) => thisTarget + 2 - i)])].sort((x, y) => y - x).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="flex gap-4 text-sm font-medium">
            <button className="text-brand hover:underline" onClick={() => setShowSources(true)}>Где взять данные</button>
            <a href="/directories" className="text-brand hover:underline">Справочники →</a>
          </div>
        </div>
        <p className="hint">Четыре источника, из которых считается рост цен. Загрузите новые данные, когда источник подсвечен жёлтым, и утвердите их — после этого прогнозы можно пересчитать.</p>
        {reference && (
          <div className="grid gap-3 md:grid-cols-2">
            {SOURCES.map((src) => {
              const yr = src.id === "rosstat" ? target - 1 : target;
              const mine = indices.filter((i) => i.year === yr && src.match(i));
              const pending = mine.filter((i) => !i.approved);
              const changed = pending.filter((i) => i.pending_of).length;
              const st = stale.find((x) => x.id === src.id);
              const last = mine.map((i) => i.loaded_at).filter(Boolean).sort().pop();
              const ok = !st && mine.length > 0;
              return (
                <div key={src.id} className={`flex flex-col gap-3 rounded-xl border p-4 ${st ? "border-amber-300 bg-amber-50/40" : "border-slate-200"}`}>
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-slate-900">{src.title}</p>
                      <span className={`whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ${ok ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : st ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-slate-50 text-slate-500 ring-slate-200"}`}>
                        {ok ? "Актуально" : st ? "Обновить" : "Не используется"}
                      </span>
                    </div>
                    <p className="hint">{src.what}</p>
                    <p className="mt-1 text-sm text-slate-700">
                      {st ? <span className="text-amber-800">{st.reason[0].toUpperCase() + st.reason.slice(1)}.</span>
                        : last ? `Загружено ${new Date(last).toLocaleDateString("ru-RU")} · ${mine.length} ${plural(mine.length, "значение", "значения", "значений")}` : "Пока не загружали — не обязательно."}
                    </p>
                  </div>
                  {pending.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
                      <span className="mr-auto">Ждут проверки: {pending.length}{changed ? `, из них изменились ${changed}` : ""}</span>
                      <button className="text-amber-900 underline-offset-2 hover:underline" onClick={() => { setTabKind(src.tab); setOnlyPending(true); setShowAll(true); setTimeout(() => document.getElementById("all-indices")?.scrollIntoView({ behavior: "smooth" }), 50); }}>Посмотреть</button>
                      {canEdit && <button className="btn !px-3 !py-1" disabled={busy} onClick={() => approve(pending.map((i) => i.id))}><IconCheck width={16} height={16} />Утвердить все</button>}
                    </div>
                  )}
                  {canEdit && <div>
                    {src.id === "mer" && <MerImportButton reference={reference} targetYear={target} disabled={busy} onDone={afterMer} />}
                    {src.id === "cbr" && <CbrField reference={reference} year={target} onDone={async (m) => { setNotice(m); await reload(); }} />}
                    {src.id === "rosstat" && <RosstatImportButton reference={reference} baseYear={target - 1} disabled={busy} onDone={afterRosstat} />}
                    {src.id === "minstroy" && <MinstroyImportButton reference={reference} targetYear={target} disabled={busy} onDone={afterMinstroy} />}
                  </div>}
                </div>
              );
            })}
          </div>
        )}
        {notice && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <span>{notice}</span>
            <button className="text-emerald-700 hover:underline" onClick={() => setNotice(null)}>Скрыть</button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
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


      <div id="all-indices" className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => setShowAll(!showAll)} className="flex items-center gap-2 text-left text-lg font-semibold text-slate-900 hover:text-brand">
            <span className={`text-slate-400 transition ${showAll ? "rotate-90" : ""}`}>›</span>Все индексы на {target} год
            <span className="text-sm font-normal text-slate-500">по отраслям, инфляция, зарплаты, курс, стройка, пересчёт по месяцам</span>
          </button>
          {showAll && <div className="flex flex-wrap items-center gap-2">
            {canEdit && <UploadButton busy={busy} onFile={upload} />}
            <button className="btn-sec" disabled={!reference} onClick={() => reference && downloadWorkbook(indexTemplate(indices, reference.sources), "Индексы роста цен.xlsx")}><IconDownload />Скачать в Excel</button>
            <button className="text-sm text-brand underline-offset-2 hover:underline" onClick={() => downloadWorkbook(indexTemplate([], reference?.sources), "Шаблон индексов.xlsx")}>Пустой шаблон</button>
          </div>}
        </div>
        {showAll && <>
        {pendingTotal > 0 && (
          <button onClick={() => {
            const next = !onlyPending; setOnlyPending(next);
            if (next && !indices.some((i) => i.kind === kind && !i.approved)) {
              const k = indices.find((i) => !i.approved)!.kind;
              setTabKind(k.replace(/_cons$/, "") as IndexKind);
            }
          }} className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition ${onlyPending ? "bg-amber-100 text-amber-900 ring-amber-300" : "bg-amber-50 text-amber-800 ring-amber-200 hover:bg-amber-100"}`}>
            {pendingTotal} {plural(pendingTotal, "индекс ждёт", "индекса ждут", "индексов ждут")} проверки
            <span className="text-xs font-normal">{onlyPending ? "· сейчас показаны только они, показать все" : "· показать"}</span>
          </button>
        )}

        {/* Виды индексов — одной строкой; на узком экране листаются вбок */}
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <div role="tablist" className="inline-flex min-w-max gap-1 rounded-xl bg-slate-100 p-1">
            {tabs.map((t) => {
              const list = indices.filter((i) => (i.kind === t.kind || i.kind === `${t.kind}_cons`) && i.year === yearOf(t.kind, null) && (!onlyPending || !i.approved));
              // По месяцам считаем отрасли, а не строки
              const n = t.kind === "to_december" ? new Set(list.map((i) => i.key)).size : list.length;
              const on = t.kind === tabKind;
              return (
                <button key={t.kind} role="tab" aria-selected={on} onClick={() => setTabKind(t.kind)} title={t.title}
                  className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition ${on ? "bg-white text-brand shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:bg-white/60 hover:text-slate-900"}`}>
                  {t.short}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${on ? "bg-brand text-white" : n ? "bg-slate-200 text-slate-600" : "bg-slate-200/60 text-slate-400"}`}>{n}</span>
                </button>
              );
            })}
          </div>
        </div>
        <h2 className="text-lg font-semibold text-slate-900">{tab.title}</h2>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <p className="hint max-w-3xl">{tabKind === "to_december" && lastMonth
              ? `Доводит цену договора до уровня последнего месяца с данными Росстата (сейчас — ${MONTHS[lastMonth - 1]} ${year}).`
              : tab.hint}{tabKind === "to_december" && " Если у раздела есть подгруппы, позиции с кодом подгруппы считаются по её индексу, остальные — по индексу всего раздела."}</p>
          </div>
          {canEdit && (
            <div className="flex gap-2">
              {selected.size > 0 && <button className="btn-sec" disabled={busy} onClick={() => approve([...selected])}><IconCheck width={16} height={16} />Утвердить выбранные ({selected.size})</button>}
              {rows.length > 0 && <button className="btn" onClick={() => openNew()}><IconPlus width={16} height={16} />Добавить индекс</button>}
            </div>
          )}
        </div>
        {tabKind === "minstroy" && <MinstroyHowTo />}
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
                {tabKind === "minstroy" && reference && <MinstroyImportButton reference={reference} targetYear={target} disabled={busy} onDone={afterMinstroy} />}
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
                {kt !== "none" && <th>{KEY_TITLE[kt]}</th>}
                {tab.kind === "to_december" && <th>Месяц договора</th>}
                <th className="text-right">Рост{hasScenario ? " (базовый / конс.)" : ""}</th>
                <th>Статус</th>
                {canEdit && <th className="w-40" />}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={9} className="py-8 text-center text-slate-500">На этой вкладке нет индексов, ждущих проверки</td></tr>
              )}
              {tabKind === "forecast" && reference ? (
                <>
                  {sections.map(({ sec, own, subs }) => (
                    <Fragment key={sec.letter}>
                      <tr className="bg-slate-100/80">
                        <td colSpan={colCount} className="py-2 font-semibold text-slate-900">
                          Раздел {sec.letter} — {sec.name}
                          <span className="ml-2 text-xs font-normal text-slate-500">коды {String(sec.div_from).padStart(2, "0")}{sec.div_to !== sec.div_from ? `–${String(sec.div_to).padStart(2, "0")}` : ""}</span>
                        </td>
                      </tr>
                      {own.map((ix) => renderRow(ix, false, <span className="block pl-4 text-slate-700">Весь раздел<span className="block text-xs text-slate-500">если нет индекса по коду</span></span>))}
                      {!own.length && <tr><td colSpan={colCount} className="pl-8 text-xs text-slate-400">Индекса на весь раздел нет — позиции без своего кода посчитаются по общей инфляции</td></tr>}
                      {subs.map((ix) => renderRow(ix, false, <span className="block pl-4">{industryLabel(ix.key, reference)}</span>))}
                    </Fragment>
                  ))}
                  {unsectioned.map((ix) => renderRow(ix))}
                </>
              ) : tabKind !== "to_december" ? rows.map((ix) => renderRow(ix)) : divisions.map((d) => {
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
        </>}
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
