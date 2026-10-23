"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/components/useReference";
import type { AccuracyGroup, AccuracyYear } from "@/lib/forecasts/accuracy";

const NBSP = " ";
const num = (x: number) => Math.abs(x).toLocaleString("ru-RU", { maximumFractionDigits: 1 });
const signed = (x: number | null) => (x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${num(x)}${NBSP}%`);
const pp = (x: number) => `${num(x)}${NBSP}п.${NBSP}п.`;
const rub = (x: number) => `${x.toLocaleString("ru-RU", { maximumFractionDigits: x < 100 ? 2 : 0 })}${NBSP}₽`;

export default function AccuracyPage() {
  const [data, setData] = useState<AccuracyYear[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => { api("/api/accuracy", "GET").then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e))); }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Точность прогнозов</h1>
        <p className="hint mt-1 max-w-3xl">
          На сколько выросли цены договоров за год — и кто это точнее предсказал. <b>Ручной прогноз</b> — сколько заложили закупщики в ГПЗ (НМЦ) к ценам договоров прошлого года.
          <b> Прогноз системы</b> — рост, который сервис посчитал по отчётности прошлого года и данным ЦБ, МЭР и Росстата.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && <p className="hint">Загрузка…</p>}
      {data && data.length === 0 && <div className="card text-sm text-slate-600">Пока нет прогнозов. Загрузите ГПЗ и отчётность — и здесь появится сравнение.</div>}
      {data && data.length > 0 && (() => {
        // По умолчанию — последний год, где есть и факт, и прогноз системы
        const year = sel ?? (data.find((y) => y.groups.length) ?? data[0]).year;
        const y = data.find((x) => x.year === year)!;
        return <YearCard key={y.year} y={y} years={data.map((x) => x.year)} onYear={setSel} />;
      })()}
    </div>
  );
}

function YearCard({ y, years, onYear }: { y: AccuracyYear; years: number[]; onYear: (y: number) => void }) {
  const [all, setAll] = useState(false);
  const errM = y.manual != null && y.factManual != null ? Math.abs(y.manual - y.factManual) : null;
  const errS = y.system != null && y.fact != null ? Math.abs(y.system - y.fact) : null;
  const rows = y.groups;
  const shown = all ? rows : rows.slice(0, 15);
  const closer = rows.filter((r) => r.gManual != null && Math.abs(r.gSystem - r.gFact) < Math.abs(r.gManual - r.gFact)).length;
  const withManual = rows.filter((r) => r.gManual != null).length;
  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xl font-semibold text-slate-900">
          <select aria-label="Год" className="inp w-auto py-1 text-xl font-semibold" value={y.year} onChange={(e) => onYear(Number(e.target.value))}>
            {years.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          год
        </label>
        <p className="hint">
          {y.systemFrom ? <>Прогноз системы — «<Link className="text-brand hover:underline" href={`/forecasts/${y.systemFrom.id}`}>{y.systemFrom.title}</Link>»</> : `Нет прогноза на ${y.year} год`}
          {y.factFrom ? <>; факт — отчётность {y.year} из «<Link className="text-brand hover:underline" href={`/forecasts/${y.factFrom.id}`}>{y.factFrom.title}</Link>»</> : `; нет отчётности ${y.year} года`}
        </p>
      </div>

      {!y.systemFrom || !y.factFrom ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
          Для сравнения за {y.year} год нужны два прогноза: {!y.systemFrom && <b>прогноз на {y.year} год (базовый год {y.year - 1}, ГПЗ и отчётность {y.year - 1})</b>}
          {!y.systemFrom && !y.factFrom && " и "}{!y.factFrom && <b>прогноз с базовым годом {y.year} (ГПЗ и отчётность {y.year})</b>} — из него берутся факт и НМЦ.
          <Link href="/forecasts/new" className="btn-sec ml-2 inline-flex">Новый прогноз</Link>
        </div>
      ) : !rows.length ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
          Ни один вид продукции не повторяется в двух годах: в прогнозе «{y.systemFrom.title}» {y.kinds.base} видов, в отчётности {y.year} — {y.kinds.fact}, общих нет. Сравнивать не с чем.
        </div>
      ) : <>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl bg-slate-100 p-4">
            <p className="text-sm font-medium text-slate-700">Факт: рост цен {y.year} к {y.year - 1}</p>
            <p className="mt-1 text-3xl font-semibold text-slate-900">{signed(y.fact)}</p>
            <p className="text-xs text-slate-500">по договорам · {rows.length} {rows.length === 1 ? "вид" : rows.length < 5 ? "вида" : "видов"} продукции</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <p className="text-sm font-medium text-slate-700">1 · Ручной прогноз (ГПЗ)</p>
            <p className="mt-1 text-3xl font-semibold text-slate-900">{signed(y.manual)}</p>
            <p className="text-xs text-slate-500">{withManual ? <>заложили закупщики · ошибка <b>{pp(errM!)}</b>{withManual < rows.length ? ` · по ${withManual} видам с НМЦ (факт на них ${signed(y.factManual)})` : ""}</> : "в файлах нет НМЦ"}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <p className="text-sm font-medium text-slate-700">2 · Прогноз системы</p>
            <p className="mt-1 text-3xl font-semibold text-slate-900">{signed(y.system)}</p>
            <p className="text-xs text-slate-500">ошибка <b>{errS != null ? pp(errS) : "—"}</b> · в карточке прогноза {signed(y.systemFrom.growth)} — по всем {y.systemFrom.items} позициям</p>
          </div>
        </div>
        {errM != null && errS != null && (
          <p className="text-sm">{Math.abs(errM - errS) < 0.5 ? <span className="text-slate-600">Одинаково точно</span>
            : errS < errM ? <span className="font-medium text-emerald-700">Система точнее на {pp(errM - errS)}</span>
            : <span className="font-medium text-amber-700">Ручной прогноз точнее на {pp(errS - errM)}</span>}
            <span className="text-slate-500"> — чем ближе прогноз к факту, тем точнее.{withManual ? ` По видам продукции система ближе к факту в ${closer} из ${withManual}.` : ""}</span></p>
        )}
        <p className="hint">
          Сравниваем по видам продукции — первые цифры кода ОКПД2 (например, 19.20 — нефтепродукты) и единица измерения: {y.kinds.common} общих видов из {y.kinds.base} в прогнозе и {y.kinds.fact} в отчётности {y.year}.
          Цена вида — медиана по всем его закупкам в году. Общий рост — средний по видам, взвешенный ценами {y.year - 1} года. НМЦ обычно выше цены договора — в ней заложен запас на торги.
        </p>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Вид продукции</th><th className="text-right">Цена {y.year - 1}</th><th className="text-right">Факт {y.year}</th><th className="text-right">1 · Ручной</th><th className="text-right">2 · Система</th></tr></thead>
            <tbody>{shown.map((r, i) => <Row key={i} r={r} />)}</tbody>
          </table>
          {rows.length > 15 && <button className="mt-2 text-sm text-brand hover:underline" onClick={() => setAll(!all)}>{all ? "Свернуть" : `Показать все виды (${rows.length})`}</button>}
        </div>
      </>}
    </div>
  );
}

function Row({ r }: { r: AccuracyGroup }) {
  const cell = (p: number | null, gr: number | null, bold = false) => (
    <td className={`whitespace-nowrap text-right ${bold ? "font-medium" : ""}`}>{p == null ? <span className="text-slate-400">—</span> : <>{signed(gr)}<span className="block text-xs text-slate-500">{rub(p)}</span></>}</td>
  );
  return (
    <tr>
      <td><span className="font-medium">{r.code}</span> {r.name}<span className="block text-xs text-slate-500">{r.unit} · закупок: {r.nBase} в прошлом году, {r.nFact} в этом</span></td>
      <td className="whitespace-nowrap text-right text-slate-600">{rub(r.base)}</td>
      {cell(r.fact, r.gFact, true)}{cell(r.manual, r.gManual)}{cell(r.system, r.gSystem)}
    </tr>
  );
}
