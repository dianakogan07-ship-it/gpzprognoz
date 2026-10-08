"use client";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, useReference } from "@/components/useReference";
import { COVERAGE_KEY, MONTHS, industryName } from "@/lib/indexFormat";
import { DEFAULT_VAT, explainExample, lastDataMonth, type IndexRef } from "@/lib/logic";
import type { ForecastRow } from "@/lib/forecast";
import type { Reference } from "@/lib/types";


/** Всё, что нужно для объяснения одной строки: пример или позиция из прогноза */
interface Explain {
  baseYear: number; targetYear: number;
  okpd2: string; contracts: number; months: number[];
  price: number;
  step2: { state: "off" | "applied" | "partial" | "none" | "not_needed"; coef: number | null; lastMonth: number | null; idx: IndexRef | null };
  step3: { branch: "industry" | "cpi" | "none"; level: "okpd2" | "okved2" | "cpi"; idx: IndexRef | null; needsApproval: boolean };
  basePrice: number; forecastPrice: number;
  vat: number; vatFromFile: boolean; withVat: number;
  edited?: boolean;
  row?: { title: string; forecastId: number; version: number; subject: string };
}

interface ItemResp {
  id: number; okpd2: string; subject: string; contracts: number; base_price: number; index_value: number; forecast_price: number; manually_edited: boolean;
  data: ForecastRow & { pts?: [number, number | null][] }; version: number; forecast_id: number; title: string; year: number; base_year: number;
}

const monthName = (m: number | null) => (m ? MONTHS[m - 1] : "");

function fromItem(it: ItemResp, ref: Reference): Explain {
  const d = it.data;
  const months = [...new Set((d.pts ?? []).map((p) => p[1]).filter((m): m is number => !!m))].sort((a, b) => a - b);
  const lastMonth = lastDataMonth(ref.indices, it.base_year);
  const toDecOff = !ref.indices.some((i) => i.kind === "to_december" && i.year === it.base_year);
  const state = d.toDecember === "none" && toDecOff ? "off" : d.toDecember;
  const raw = d.rawMedian || it.base_price;
  const vat = d.vatRate ?? DEFAULT_VAT;
  const src = d.indexSourceCode ? ref.sources.find((s) => s.code === d.indexSourceCode) ?? null : null;
  const idx: IndexRef | null = d.indexApproved === null ? null : { value: it.index_value, key: d.indexKey, approved: !!d.indexApproved, source: src, note: null };
  return {
    baseYear: it.base_year, targetYear: it.year, okpd2: it.okpd2, contracts: it.contracts, months,
    price: raw,
    step2: { state, coef: state === "applied" || state === "partial" ? it.base_price / raw : null, lastMonth, idx: null },
    step3: { branch: d.indexLevel !== "cpi" ? "industry" : idx ? "cpi" : "none", level: d.indexLevel, idx, needsApproval: d.needsApproval },
    basePrice: it.base_price, forecastPrice: it.forecast_price,
    vat, vatFromFile: d.vatRate != null, withVat: Math.round(it.forecast_price * (1 + vat) * 100) / 100,
    edited: it.manually_edited,
    row: { title: it.title, forecastId: it.forecast_id, version: it.version, subject: it.subject },
  };
}

function fromExample(ref: Reference, targetYear: number): Explain {
  const baseYear = targetYear - 1;
  const p = { okpd2: "01", month: 2, price: 1_000_000, vat: 0.22 };
  const e = explainExample(ref, p, baseYear, targetYear);
  const state = e.toDecOff ? "off" : e.toDec ? "applied" : "none";
  return {
    baseYear, targetYear, okpd2: p.okpd2, contracts: 1, months: [p.month], price: p.price,
    step2: { state, coef: e.toDec?.value ?? null, lastMonth: e.lastMonth, idx: e.toDec },
    step3: { branch: e.growth ? "industry" : e.cpi ? "cpi" : "none", level: e.growth?.level ?? "cpi", idx: e.growth ?? e.cpi, needsApproval: e.needsApproval },
    basePrice: e.basePrice, forecastPrice: e.forecastPrice, vat: p.vat, vatFromFile: true, withVat: e.withVat,
  };
}

const rub = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₽`;
const pct = (k: number) => `${k < 1 ? "−" : "+"}${Math.abs((k - 1) * 100).toFixed(1).replace(".", ",")} %`;
/** Название отрасли простыми словами: «Продукция и услуги сельского хозяйства» → «продукция и услуги сельского хозяйства» */
const plain = (key: string | null, ref: Reference) => {
  const n = key ? industryName(key, ref) : null;
  return n ? n.charAt(0).toLowerCase() + n.slice(1) : key ?? "";
};
const statusText = (i: IndexRef | null) => (i ? (i.approved ? "утверждён" : "ещё не утверждён") : "");

export default function LogicPage() {
  const { reference, error } = useReference();
  const [active, setActive] = useState<number | null>(null);
  const [rowId, setRowId] = useState<number | null>(null);
  const [item, setItem] = useState<ItemResp | null>(null);
  const [itemError, setItemError] = useState<string | null>(null);
  const [target, setTarget] = useState(new Date().getFullYear() + 1);

  useEffect(() => {
    try { const raw = localStorage.getItem(COVERAGE_KEY); if (raw) setTarget(JSON.parse(raw).targetYear ?? target); } catch { /* недоступно */ }
    const q = new URLSearchParams(window.location.search).get("row");
    if (q) setRowId(Number(q));
    const m = window.location.hash.match(/^#step-([1-4])$/);
    if (m) setActive(Number(m[1]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!rowId) return;
    api(`/api/items/${rowId}`, "GET").then(setItem).catch((e) => setItemError(e instanceof Error ? e.message : String(e)));
  }, [rowId]);

  const ex = useMemo(() => (reference ? (item ? fromItem(item, reference) : fromExample(reference, target)) : null), [reference, item, target]);

  function toggle(n: number) {
    const next = active === n ? null : n;
    setActive(next);
    window.history.replaceState(null, "", `${window.location.search}${next ? `#step-${next}` : ""}`);
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!reference || !ex || (rowId && !item && !itemError)) return <p className="hint">Загрузка…</p>;
  const ty = ex.targetYear, by = ex.baseYear;
  const s2 = ex.step2, s3 = ex.step3;
  const m0 = ex.months[0] ?? null;
  const industry = plain(s3.idx?.key ?? ex.okpd2, reference);

  // Шаг 2: рост внутри года
  const step2Caption = s2.state === "off" ? "пересчёт не загружен" : s2.state === "not_needed" ? "договор декабря" : s2.state === "none" ? "нет данных за месяц"
    : ex.months.length > 1 ? "рост внутри года, в среднем" : `рост с ${MONTHS_GEN_FROM(m0)} по ${s2.lastMonth ? MONTHS[s2.lastMonth - 1] : "последний месяц"}`;
  const steps = [
    { n: 1, value: rub(ex.price), caption: ex.contracts > 1 ? "медиана цен договоров" : "цена договора",
      info: <>Фактическая цена из отчётности за {by} год, за единицу и без НДС.{ex.contracts > 1 ? ` Договоров: ${ex.contracts}, взята медиана.` : ""}</>,
      what: `Берём цену из договора ${by} года по отчётности — за единицу и без НДС. Если договоров несколько, берём медиану — цену из середины списка, а цены, отличающиеся больше чем в 2 раза, не учитываем.`, tab: null },
    { n: 2, value: s2.coef ? pct(s2.coef) : "+0,0 %", caption: step2Caption,
      info: s2.state === "off" ? <>Индексы перерасчёта по месяцам за {by} год не загружены — шаг пропущен.</>
        : <>Росстат, цены производителей. {s2.idx?.source && <SrcLink s={s2.idx.source} />} {statusText(s2.idx) && `Индекс ${statusText(s2.idx)}.`} Вкладка «Перерасчёт цен по месяцам».</>,
      what: "Договор, заключённый в начале года, не учитывает последующий рост цен — доводим его цену до последнего месяца, за который Росстат опубликовал данные.", tab: "to_december" },
    { n: 3, value: s3.idx ? pct(s3.idx.value) : "+0,0 %", caption: s3.branch === "industry" ? `рост отрасли в ${ty}` : s3.branch === "cpi" ? `общая инфляция ${ty}` : "индекса нет",
      warn: s3.branch !== "industry",
      info: <>{s3.branch === "industry" ? `Отрасль: ${industry}.` : `Индекса отрасли нет — взята общая инфляция.`} {s3.idx?.source && <SrcLink s={s3.idx.source} />} {statusText(s3.idx) && `Индекс ${statusText(s3.idx)}.`} Вкладка «{s3.branch === "industry" ? `Рост цен по отраслям ${ty}` : `Общая инфляция ${ty}`}».</>,
      what: `Умножаем цену на ожидаемый рост цен в отрасли позиции в ${ty} году. Отрасль определяем по коду ОКПД2 из ГПЗ.`, tab: s3.branch === "industry" ? "forecast" : "cpi" },
    { n: 4, value: rub(ex.forecastPrice), sub: `${rub(ex.withVat)} с НДС ${Math.round(ex.vat * 100)} %`, caption: "без НДС",
      info: <>{ex.vatFromFile ? "Ставка НДС из строки ГПЗ." : `В файлах нет ставки НДС — взята основная ставка ${Math.round(DEFAULT_VAT * 100)} %.`}{ex.edited ? " Цена позиции изменена вручную." : ""}</>,
      what: "Получаем прогноз сразу в двух видах: без НДС и с НДС по ставке из строки ГПЗ.", tab: null },
  ];
  const cur = steps.find((s) => s.n === active);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Логика расчётов</h1>
        <p className="hint mt-1">Как получается прогнозная цена на {ty} год.</p>
      </div>

      <div className="card space-y-5">
        {itemError && <p className="text-sm text-red-600">Не удалось открыть позицию: {itemError}. Показан общий пример.</p>}
        <ol className="flex flex-col md:flex-row md:items-start">
          {steps.map((s, i) => (
            <li key={s.n} id={`step-${s.n}`} className="flex flex-col md:flex-1 md:flex-row md:items-start">
              <div className="flex items-center gap-4 md:w-full md:flex-col md:gap-2 md:text-center">
                <button type="button" onClick={() => toggle(s.n)} aria-expanded={active === s.n} aria-label={`Шаг ${s.n}`}
                  className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-4 text-lg font-semibold transition md:h-16 md:w-16 ${active === s.n
                    ? "border-brand bg-brand text-white shadow-lg shadow-brand/20" : "border-brand/30 bg-white text-brand hover:border-brand"}`}>
                  {String(s.n).padStart(2, "0")}
                </button>
                <div className="min-w-0">
                  <div className="flex items-center gap-1 md:justify-center">
                    <button type="button" onClick={() => toggle(s.n)} className={`whitespace-nowrap text-xl font-semibold ${s.warn ? "text-amber-700" : "text-slate-900"}`}>{s.value}</button>
                    <Info>{s.info}</Info>
                  </div>
                  <p className="text-sm text-slate-500">{s.caption}</p>
                  {s.sub && <p className="mt-1 text-base font-semibold text-slate-700">{s.sub}</p>}
                  {s.warn && <p className="text-xs font-medium text-amber-700">согласовать</p>}
                </div>
              </div>
              {i < steps.length - 1 && <span aria-hidden className="ml-7 h-5 border-l-2 border-dashed border-brand/40 md:ml-0 md:mt-8 md:h-0 md:w-8 md:shrink-0 md:border-l-0 md:border-t-2 lg:w-12" />}
            </li>
          ))}
        </ol>

        {cur && (
          <div className="rounded-xl border border-brand/30 bg-brand-light/40 p-4 text-sm text-slate-700">
            <p>{cur.what}</p>
            {cur.n === 3 && <p className="mt-2">Нет индекса отрасли → общая инфляция, пометка «Согласовать».</p>}
            {cur.tab && <Link href={`/indices?tab=${cur.tab}`} className="mt-2 inline-block font-medium text-brand hover:underline">Смотреть индексы →</Link>}
          </div>
        )}

        <p className="text-sm text-slate-600">
          {ex.row
            ? <>Позиция «{ex.row.subject}» из прогноза <Link href={`/forecasts/${ex.row.forecastId}`} className="text-brand hover:underline">{ex.row.title}</Link>. <Link href="/logic" className="text-brand hover:underline">Общий пример</Link></>
            : <>Пример на договоре {m0 ? MONTHS_GEN_OF(m0) : ""} {by}, {industry}. Расчёт своей позиции — кнопка «Как посчитано» в таблице прогноза.</>}
        </p>
      </div>
    </div>
  );
}

const MONTHS_GEN_FROM = (m: number | null) => (m ? ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"][m - 1] : "начала года");
const MONTHS_GEN_OF = (m: number) => ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"][m - 1];

function SrcLink({ s }: { s: { name: string; url: string } }) {
  return s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">{s.name}</a> : <>{s.name}</>;
}

/** Иконка «i» с подсказкой: по наведению и по нажатию на телефоне */
function Info({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="group/info relative inline-flex" onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label="Откуда число" onClick={() => setOpen(!open)}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-400 text-[10px] font-semibold leading-none text-slate-500 hover:border-brand hover:text-brand">i</button>
      <span className={`absolute -left-28 top-full z-20 mt-1 w-60 md:left-1/2 md:w-64 md:-translate-x-1/2 rounded-lg border border-slate-200 bg-white p-3 text-left text-xs font-normal text-slate-700 shadow-lg transition group-hover/info:visible group-hover/info:opacity-100 ${open ? "visible opacity-100" : "invisible opacity-0"}`}>
        {children}
      </span>
    </span>
  );
}
