"use client";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, useReference } from "@/components/useReference";
import { COVERAGE_KEY, MONTHS, formatGrowth, industryLabel } from "@/lib/indexFormat";
import { DEFAULT_VAT, explainExample, lastDataMonth, type IndexRef } from "@/lib/logic";
import { fmtRub, plural } from "@/lib/forecastView";
import type { ForecastRow } from "@/lib/forecast";
import type { Reference } from "@/lib/types";

const STEPS = [
  { n: 1, title: "Базовая цена", short: "Цена договора прошлого года" },
  { n: 2, title: "Пересчёт внутри года", short: "До последнего месяца с данными" },
  { n: 3, title: "Рост цен", short: "Индекс отрасли или инфляция" },
  { n: 4, title: "НДС и итог", short: "Ориентир цены с НДС" },
];

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

const pctOf = (k: number) => formatGrowth(k);
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

export default function LogicPage() {
  const { reference, error } = useReference();
  const [active, setActive] = useState(1);
  const [rowId, setRowId] = useState<number | null>(null);
  const [item, setItem] = useState<ItemResp | null>(null);
  const [itemError, setItemError] = useState<string | null>(null);
  const [target, setTarget] = useState(new Date().getFullYear() + 1);

  useEffect(() => {
    try { const raw = localStorage.getItem(COVERAGE_KEY); if (raw) setTarget(JSON.parse(raw).targetYear ?? target); } catch { /* недоступно */ }
    const q = new URLSearchParams(window.location.search).get("row");
    if (q) setRowId(Number(q));
    const m = window.location.hash.match(/^#step-([1-4])$/);
    if (m) {
      setActive(Number(m[1]));
      setTimeout(() => document.getElementById(`step-${m[1]}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!rowId) return;
    api(`/api/items/${rowId}`, "GET").then(setItem).catch((e) => setItemError(e instanceof Error ? e.message : String(e)));
  }, [rowId]);

  const ex = useMemo(() => (reference ? (item ? fromItem(item, reference) : fromExample(reference, target)) : null), [reference, item, target]);

  function open(n: number) {
    setActive(n);
    window.history.replaceState(null, "", `${window.location.search}#step-${n}`);
    document.getElementById(`step-${n}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!reference || !ex || (rowId && !item && !itemError)) return <p className="hint">Загрузка…</p>;
  const ty = ex.targetYear, by = ex.baseYear;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Логика расчётов</h1>
        <p className="hint mt-1">Как сервис получает прогнозную цену на {ty} год — за четыре шага.</p>
      </div>

      {/* Инфографика */}
      <div className="card">
        <ol className="flex flex-col items-stretch md:flex-row md:items-start">
          {STEPS.map((s, i) => (
            <li key={s.n} className="flex flex-col md:flex-1 md:flex-row md:items-start">
              <button type="button" onClick={() => open(s.n)} aria-current={active === s.n ? "step" : undefined}
                className="group flex items-center gap-4 text-left md:w-full md:flex-col md:gap-2 md:text-center">
                <span className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 text-xl font-semibold transition md:h-20 md:w-20 md:text-2xl ${active === s.n
                  ? "border-brand bg-brand text-white shadow-lg shadow-brand/20" : "border-brand/30 bg-white text-brand group-hover:border-brand"}`}>
                  {String(s.n).padStart(2, "0")}
                </span>
                <span>
                  <span className={`block font-semibold ${active === s.n ? "text-brand" : "text-slate-900"}`}>{s.n === 3 ? `${s.title} на ${ty}` : s.title}</span>
                  <span className="block text-sm text-slate-500">{s.short}</span>
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <span aria-hidden className="ml-8 h-6 border-l-2 border-dashed border-brand/40 md:ml-0 md:mt-10 md:h-0 md:w-12 md:shrink-0 md:border-l-0 md:border-t-2 lg:w-20" />
              )}
            </li>
          ))}
        </ol>
      </div>

      {/* Пример */}
      <Example ex={ex} item={item} itemError={itemError} />

      {/* Шаги */}
      <div className="space-y-3">
        <Step n={1} active={active} onOpen={open} title="Базовая цена"
          what={`Берём фактическую цену из договоров ${by} года по отчётности — за единицу и без НДС.`}
          formula="цена за единицу = сумма договора без НДС / количество; если договоров несколько — берём среднюю (медиану), а цены, отличающиеся больше чем в 2 раза, не учитываем"
          link={<Link href="/directories" className="text-brand hover:underline">Справочники → Повторяемость закупок</Link>}>
          <p>Позиции ГПЗ без заключённого договора в расчёт не попадают — их видно в карточке прогноза по ссылке «не вошли».</p>
          <p>Разовые закупки (по справочнику повторяемости) считаются, но помечаются как справочный ориентир.</p>
          {ex.row && <p className="text-slate-900">Для этой позиции: {ex.contracts} {plural(ex.contracts, "договор", "договора", "договоров")}, базовая цена {fmtRub(ex.price)}.</p>}
        </Step>

        <Step n={2} active={active} onOpen={open} title="Пересчёт внутри года" extra
          what={`Договор, заключённый в начале года, не учитывает рост цен за следующие месяцы. Доводим его цену до уровня последнего месяца, за который Росстат опубликовал данные${ex.step2.lastMonth ? ` (сейчас — ${monthName(ex.step2.lastMonth)} ${by})` : ""}.`}
          formula="коэффициент = индекс цен производителей последнего месяца / индекс цен производителей месяца договора (оба — к декабрю прошлого года)"
          link={<Link href="/indices?tab=to_december" className="text-brand hover:underline">Индексы → Пересчёт цен внутри года</Link>}>
          {ex.step2.state === "off" && <Notice tone="slate">Шаг пропущен: индексы пересчёта внутри {by} года не загружены. Цена договора берётся как есть.</Notice>}
          {ex.step2.state === "none" && <Notice tone="amber">Для месяца договора нет коэффициента — цена взята без пересчёта.</Notice>}
          {ex.step2.state === "not_needed" && <Notice tone="slate">Договоры заключены в декабре — пересчёт не нужен.</Notice>}
          {ex.step2.state === "partial" && <Notice tone="amber">Коэффициенты есть не для всех договоров позиции — часть цен взята без пересчёта.</Notice>}
          {ex.row && ex.months.length > 0 && <p className="text-slate-900">Месяцы договоров: {ex.months.map(monthName).join(", ")}.</p>}
        </Step>

        <Step n={3} active={active} onOpen={open} title={`Рост цен на ${ty}`}
          what={`Ищем ожидаемый рост цен для отрасли позиции по её коду ОКПД2.`}
          formula={`прогноз без НДС = цена после шага 2 × индекс роста цен на ${ty}`}
          link={<><Link href="/indices?tab=forecast" className="text-brand hover:underline">Индексы → Рост цен по отраслям {ty}</Link>{" · "}<Link href="/indices?tab=cpi" className="text-brand hover:underline">Общая инфляция {ty}</Link></>}>
          <Fork ex={ex} reference={reference} />
          <Notice tone="slate">Неверный код ОКПД2 в ГПЗ даёт неверный индекс. Например, бумага с кодом 28 получит индекс машиностроения вместо индекса бумажной отрасли (код 17).</Notice>
        </Step>

        <Step n={4} active={active} onOpen={open} title="НДС и итог"
          what="Начисляем НДС по ставке из строки ГПЗ. Получаем ориентир цены с НДС."
          formula="итог = прогноз без НДС × (1 + ставка НДС)"
          link={<span className="text-slate-500">Таблица прогноза и выгрузка в Excel показывают цену без НДС.</span>}>
          {!ex.vatFromFile && <Notice tone="slate">В файлах нет ставки НДС для этой позиции — взята основная ставка {Math.round(DEFAULT_VAT * 100)} %.</Notice>}
          {ex.edited && <Notice tone="amber">Цена этой позиции изменена вручную — итог отличается от расчёта по формуле.</Notice>}
        </Step>
      </div>
    </div>
  );
}

function Step({ n, active, onOpen, title, what, formula, link, extra, children }: {
  n: number; active: number; onOpen: (n: number) => void; title: string; what: string; formula: string; link: ReactNode; extra?: boolean; children?: ReactNode;
}) {
  const open = active === n;
  return (
    <section id={`step-${n}`} className={`card scroll-mt-4 transition ${open ? "ring-2 ring-brand" : ""}`}>
      <button type="button" className="flex w-full items-start gap-3 text-left" onClick={() => onOpen(n)} aria-expanded={open}>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${open ? "bg-brand text-white" : "bg-brand-light text-brand"}`}>{n}</span>
        <span className="min-w-0 flex-1">
          <span className="font-semibold text-slate-900">{title}</span>
          {extra && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">доп. настройка</span>}
          <span className="mt-0.5 block text-sm text-slate-600">{what}</span>
        </span>
        <span className={`text-slate-400 transition ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2 pl-11 text-sm text-slate-700">
          <p><span className="font-medium text-slate-900">Формула словами:</span> {formula}.</p>
          <p><span className="font-medium text-slate-900">Данные:</span> {link}</p>
          {children}
        </div>
      )}
    </section>
  );
}

function Notice({ tone, children }: { tone: "amber" | "slate"; children: ReactNode }) {
  return <p className={`rounded-lg px-3 py-2 ${tone === "amber" ? "border border-amber-200 bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-600"}`}>{children}</p>;
}

/** Развилка шага 3: отраслевой индекс или общая инфляция */
function Fork({ ex, reference }: { ex: Explain; reference: Reference }) {
  const s = ex.step3;
  const industry = s.branch === "industry";
  const box = (on: boolean) => `rounded-lg border p-3 ${on ? "border-brand bg-brand-light/50" : "border-dashed border-slate-200 text-slate-400"}`;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className={box(industry)}>
        <p className="font-medium">Нашли отрасль →</p>
        <p>отраслевой индекс{industry && s.idx ? `: ${industryLabel(s.idx.key, reference)}, ${pctOf(s.idx.value)}` : ""}</p>
        {industry && s.level === "okved2" && <p className="text-xs text-slate-500">по коду ОКПД2 индекса нет — взят индекс раздела отрасли</p>}
      </div>
      <div className={box(!industry)}>
        <p className="font-medium">Не нашли →</p>
        <p>общая инфляция{!industry && s.idx ? `, ${pctOf(s.idx.value)}` : ""} + пометка</p>
        <span className={`mt-1 inline-block rounded-md px-2 py-0.5 text-xs font-medium ${!industry ? "bg-amber-100 text-amber-900" : "bg-slate-100"}`}>Согласовать человеком</span>
        {s.branch === "none" && <p className="mt-1 text-xs text-amber-800">Общей инфляции на {ex.targetYear} тоже нет — цена не проиндексирована.</p>}
      </div>
      {industry && s.needsApproval && <p className="text-xs text-amber-800 sm:col-span-2">Индекс ещё не утверждён — позиция тоже требует согласования.</p>}
    </div>
  );
}

function Src({ idx, tab, label }: { idx: IndexRef | null; tab: string; label: string }) {
  return (
    <>
      <Link href={`/indices?tab=${tab}`} className="text-brand hover:underline">{label}</Link>
      {idx?.source && <> · {idx.source.url ? <a href={idx.source.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">{idx.source.name}</a> : idx.source.name}</>}
      {idx && <> · <span className={idx.approved ? "text-emerald-700" : "text-amber-700"}>{idx.approved ? "утверждён" : "не утверждён"}</span></>}
    </>
  );
}

function Node({ value, caption, strong }: { value: ReactNode; caption: ReactNode; strong?: boolean }) {
  return (
    <div className="min-w-0 md:flex-1">
      <p className={`whitespace-nowrap ${strong ? "text-lg font-semibold text-slate-900" : "font-medium text-slate-900"}`}>{value}</p>
      <p className="mt-0.5 text-xs leading-snug text-slate-500">{caption}</p>
    </div>
  );
}
const Arrow = ({ sign = "→" }: { sign?: string }) => <span aria-hidden className="pt-0.5 text-slate-400"><span className="md:hidden">{sign === "→" ? "↓" : sign}</span><span className="hidden md:inline">{sign}</span></span>;

function Example({ ex, item, itemError }: { ex: Explain; item: ItemResp | null; itemError: string | null }) {
  const s2 = ex.step2, s3 = ex.step3;
  const m0 = ex.months[0] ?? null;
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-slate-900">{ex.row ? "Как посчитана позиция" : "Пример расчёта"}</h2>
        {ex.row
          ? <span className="text-sm text-slate-600">{ex.row.subject} · ОКПД2 {ex.okpd2} · <Link href={`/forecasts/${ex.row.forecastId}`} className="text-brand hover:underline">{ex.row.title}, v{ex.row.version}</Link> · <Link href="/logic" className="text-brand hover:underline">общий пример</Link></span>
          : <span className="text-sm text-slate-600">Договор {monthName(m0)} {ex.baseYear}, отрасль ОКПД2 {ex.okpd2}, НДС {Math.round(ex.vat * 100)} %. Индексы — из базы на сегодня.</span>}
      </div>
      {itemError && <p className="text-sm text-red-600">Не удалось открыть позицию: {itemError}. Показан общий пример.</p>}
      <div className="flex flex-col gap-2 rounded-lg bg-slate-50 p-4 md:flex-row md:items-start md:gap-3">
        <Node value={fmtRub(ex.price)} caption={ex.row ? `${ex.contracts > 1 ? "медиана цен договоров" : "цена договора"} ${ex.baseYear}, без НДС` : `цена договора ${ex.baseYear}, без НДС`} />
        <Arrow />
        <Node value={s2.coef ? `× ${s2.coef.toFixed(4).replace(".", ",")}` : "× 1"}
          caption={s2.state === "off" ? "пересчёт внутри года выключен — шаг пропущен"
            : s2.state === "not_needed" ? "договор декабря — пересчёт не нужен"
            : s2.state === "none" ? "нет коэффициента за месяц договора"
            : <>{ex.row && ex.months.length > 1 ? "в среднем по договорам" : `${monthName(m0)} → ${monthName(s2.lastMonth)}`}{!ex.row && <> · <Src idx={s2.idx} tab="to_december" label="Пересчёт внутри года" /></>}{ex.row && <> · <Link href="/indices?tab=to_december" className="text-brand hover:underline">Пересчёт внутри года</Link></>}</>} />
        <Arrow />
        <Node value={`× ${s3.idx ? s3.idx.value.toFixed(4).replace(".", ",") : "1"}`}
          caption={s3.branch === "none" ? "индекса нет — без роста" : <>
            {s3.branch === "industry" ? `рост отрасли ${s3.idx?.key ?? ""} на ${ex.targetYear}` : `общая инфляция ${ex.targetYear}`} · <Src idx={s3.idx} tab={s3.branch === "industry" ? "forecast" : "cpi"} label="Индексы" />
            {s3.branch !== "industry" && <span className="mt-1 block font-medium text-amber-800">Согласовать человеком</span>}
          </>} />
        <Arrow />
        <Node value={`+ НДС ${Math.round(ex.vat * 100)} %`} caption={ex.vatFromFile ? "ставка из ГПЗ" : "ставки нет в файлах — основная ставка"} />
        <Arrow sign="=" />
        <Node strong value={fmtRub(ex.withVat)} caption={<>ориентир на {ex.targetYear} с НДС · без НДС {fmtRub(ex.forecastPrice)}{ex.edited ? " · изменено вручную" : ""}</>} />
      </div>
      {!item && <p className="hint">Чтобы увидеть расчёт конкретной позиции, нажмите «Как посчитано» в строке таблицы прогноза.</p>}
    </div>
  );
}
