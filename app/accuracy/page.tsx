"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/components/useReference";
import { MIN_REPEATS, type AccuracyYear } from "@/lib/forecasts/accuracy";
import { useReserve } from "@/components/NmcSummary";

const NBSP = " ";
const num = (x: number) => Math.abs(x).toLocaleString("ru-RU", { maximumFractionDigits: 1 });
const signed = (x: number | null) => (x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${num(x)}${NBSP}%`);
const pct = (x: number | null) => (x == null ? "—" : `${num(x)}${NBSP}%`);
const rub = (x: number) => `${x.toLocaleString("ru-RU", { maximumFractionDigits: x < 100 ? 2 : 0 })}${NBSP}₽`;
const plural = (n: number, a: string, b: string, c: string) => (n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? b : c);

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
          Насколько закупщики ошибаются, планируя НМЦ, и насколько точен прогноз системы. <b>Надбавка закупщиков</b> — на сколько НМЦ в ГПЗ была выше цены заключённого договора; средняя надбавка прошлых лет входит в рекомендуемую НМЦ на следующий год.
          <b> Ошибка системы</b> проверяется на закупках, которые повторяются из года в год.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && <p className="hint">Загрузка…</p>}
      {data && data.length === 0 && <div className="card text-sm text-slate-600">Пока нет прогнозов. Загрузите ГПЗ и отчётность за год — и здесь появится сравнение.</div>}
      {data && data.length > 0 && (() => {
        const year = sel ?? (data.find((y) => y.repeats.n) ?? data.find((y) => y.manual.n) ?? data[0]).year;
        const y = data.find((x) => x.year === year)!;
        return <YearView key={y.year} y={y} years={data.map((x) => x.year)} onYear={setSel} />;
      })()}
    </div>
  );
}

function YearView({ y, years, onYear }: { y: AccuracyYear; years: number[]; onYear: (y: number) => void }) {
  const m = y.manual, r = y.repeats;
  const [allLots, setAllLots] = useState(false);
  const [allRep, setAllRep] = useState(false);
  const enough = r.n >= MIN_REPEATS;
  const reserve = useReserve(y.year);
  // Ошибка ручного — на тех же закупках, что и у системы; если их нет — по всем закупкам года
  // Пока повторяющихся закупок мало, систему не оцениваем: одна-две закупки — случайность
  const manualErr = enough && r.compared ? r.manualError : m.typical;
  const sysErr = enough ? r.systemError : null;
  const verdict = manualErr == null || sysErr == null ? null
    : Math.abs(manualErr - sysErr) < 1 ? "Система и ручной прогноз ошибаются одинаково."
    : sysErr < manualErr ? `Система точнее ручного прогноза на ${num(manualErr - sysErr)} п. п.${r.compared ? ` — ближе к факту в ${r.systemCloser} из ${r.compared} ${plural(r.compared, "закупки", "закупок", "закупок")}.` : ""}`
    : `Ручной прогноз точнее системы на ${num(sysErr - manualErr)} п. п.${r.compared ? ` — система ближе к факту только в ${r.systemCloser} из ${r.compared} ${plural(r.compared, "закупки", "закупок", "закупок")}.` : ""}`;
  const notes = [
    !y.systemFrom && `Нет прогноза системы на ${y.year} год — создайте его из ГПЗ и отчётности ${y.year - 1} года (год прогноза ${y.year}, базовый ${y.year - 1}).`,
    y.systemFrom && !r.n && `Ни одна закупка не повторяется в ${y.year - 1} и ${y.year} годах (тот же код ОКПД2 и единица) — проверить систему не на чем.`,
    r.n > 0 && !enough && `Повторяющихся закупок только ${r.n} — мало для надёжного вывода, нужно хотя бы ${MIN_REPEATS}.`,
    !m.source && `В файлах ${y.year} года нет НМЦ — ручной прогноз проверить нельзя.`,
    m.outliers > 0 && `${m.outliers} ${plural(m.outliers, "закупка", "закупки", "закупок")}, где НМЦ и договор отличаются больше чем в 3 раза, в средние не входят — скорее всего, договор заключён не на весь объём или ошибка в файле. Они отмечены в списке всех закупок.`,
    m.source === "report" && `НМЦ взята из отчётности (цена на момент торгов), а не из ГПЗ. Чтобы проверить план, обновите файлы прогноза «${y.factFrom!.title}»: «⋯» → «Редактировать».`,
  ].filter(Boolean) as string[];
  return (
    <div className="card space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Год" className="inp w-auto py-1 text-xl font-semibold" value={y.year} onChange={(e) => onYear(Number(e.target.value))}>
          {years.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <span className="text-xl font-semibold text-slate-900">год</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile value={signed(m.median)} label={`Надбавка закупщиков в ${y.year}: на столько НМЦ в ГПЗ была выше договора`} strong />
        <Tile value={pct(manualErr)} label="Ошибка ручного прогноза: на сколько НМЦ отличается от договора по одной закупке" />
        <Tile value={sysErr != null ? pct(sysErr) : "—"} label={sysErr != null ? "Ошибка прогноза системы" : `Ошибка системы: проверить не на чем — одинаковых закупок в ${y.year - 1} и ${y.year} годах ${r.n ? `только ${r.n}` : "нет"}, нужно хотя бы ${MIN_REPEATS}`} />
      </div>

      <div className="rounded-xl bg-brand-light/50 px-4 py-3 text-sm text-slate-800 ring-1 ring-brand/20">
        <b>Вывод: </b>{verdict ?? (m.median != null ? `закупщики в ${y.year} году закладывали НМЦ в среднем на ${pct(Math.abs(m.median))} ${m.median >= 0 ? "выше" : "ниже"} итоговых договоров.` : "сравнить пока нельзя — не хватает данных.")}
        {reserve?.overall != null && <span className="text-slate-600"> Средняя надбавка за {reserve.years.map((x) => x.year).join(", ")} — {signed(reserve.overall)}: она входит в рекомендуемую НМЦ на {y.year + 1} год.</span>}
        {enough && <span className="text-slate-600"> Закупщики заложили {signed(r.manualGrowth)}, система предсказала {signed(r.systemGrowth)}, по факту {signed(r.fact)}.</span>}
      </div>
      {notes.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-500">{notes.map((n) => <li key={n}>{n}</li>)}</ul>}

      {r.n > 0 && (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Закупка</th><th className="text-right">Договор {y.year - 1}</th><th className="text-right">Договор {y.year}</th><th className="text-right">Ручной</th><th className="text-right">Система</th></tr></thead>
            <tbody>{(allRep ? r.rows : r.rows.slice(0, 15)).map((x, i) => {
              const c = (p: number | null) => <td className="whitespace-nowrap text-right">{p == null ? <span className="text-slate-400">—</span> : <>{rub(p)}<span className="block text-xs text-slate-500">ошибка {pct(Math.abs(p / x.fact - 1) * 100)}</span></>}</td>;
              return (
                <tr key={i}><td>{x.subject}<span className="block text-xs text-slate-500">{[x.okpd2, x.region, x.unit, x.sameRegion ? "" : "другой регион"].filter(Boolean).join(" · ")}</span></td>
                  <td className="whitespace-nowrap text-right text-slate-600">{rub(x.base)}</td>
                  <td className="whitespace-nowrap text-right font-medium">{rub(x.fact)}<span className="block text-xs font-normal text-slate-500">{signed((x.fact / x.base - 1) * 100)}</span></td>
                  {c(x.manual)}{c(x.system)}</tr>
              );
            })}</tbody>
          </table>
          {r.rows.length > 15 && <button className="mt-2 text-sm text-brand hover:underline" onClick={() => setAllRep(!allRep)}>{allRep ? "Свернуть" : `Показать все (${r.rows.length})`}</button>}
        </div>
      )}

      {m.byCat.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-slate-900">Надбавка закупщиков по категориям — на столько НМЦ в ГПЗ {y.year} была выше договора</p>
          <p className="hint">Медиана по закупкам. Средняя надбавка за прошлые годы входит в рекомендуемую НМЦ по этой категории.</p>
          <table className="tbl mt-1">
            <thead><tr><th>Категория</th><th className="text-right">Закупок</th><th className="text-right">Надбавка</th></tr></thead>
            <tbody>{m.byCat.map((c) => <tr key={c.category}><td>{c.category}</td><td className="text-right text-slate-600">{c.n}</td><td className="text-right font-medium">{signed(c.reserve)}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      {m.n > 0 && (
        <details className="group">
          <summary className="cursor-pointer select-none text-sm font-medium text-slate-700 hover:text-brand">Все закупки {y.year}: заложили в ГПЗ и договор ({m.n}) · по сумме заложили {signed(m.bySum)}</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Закупка</th><th className="text-right">Заложили (НМЦ)</th><th className="text-right">Договор</th><th className="text-right">Отклонение</th></tr></thead>
              <tbody>{(allLots ? m.lots : m.lots.slice(0, 15)).map((l, i) => (
                <tr key={i}><td>{l.subject}<span className="block text-xs text-slate-500">{[l.lot, l.region, l.unit].filter(Boolean).join(" · ")}</span></td>
                  <td className="whitespace-nowrap text-right">{rub(l.plan)}</td><td className="whitespace-nowrap text-right font-medium">{rub(l.fact)}</td>
                  <td className={`whitespace-nowrap text-right ${Math.abs(l.dev) > 20 ? "text-amber-700" : "text-slate-600"}`}>{signed(l.dev)}{l.outlier && <span className="block text-xs text-red-600">не в среднем — проверить</span>}</td></tr>
              ))}</tbody>
            </table>
            {m.lots.length > 15 && <button className="mt-2 text-sm text-brand hover:underline" onClick={() => setAllLots(!allLots)}>{allLots ? "Свернуть" : `Показать все (${m.lots.length})`}</button>}
          </div>
        </details>
      )}
      <p className="hint">Ошибка — насколько прогноз цены отличался от цены договора, меньше — лучше. Сравниваем на закупках, которые повторяются в {y.year - 1} и {y.year} годах (тот же код ОКПД2 и единица). Прогноз системы — «{y.systemFrom?.title ?? "нет"}», договоры {y.year} — «{y.factFrom!.title}».</p>
    </div>
  );
}

function Tile({ value, label, strong }: { value: string; label: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl p-4 ${strong ? "bg-slate-100" : "bg-slate-50 ring-1 ring-slate-200"}`}>
      <p className="text-sm text-slate-600">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
