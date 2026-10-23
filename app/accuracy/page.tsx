"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/components/useReference";
import { MIN_REPEATS, type AccuracyYear } from "@/lib/forecasts/accuracy";

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
          <b>Ручной прогноз</b> — цена, которую закупщик заложил в ГПЗ (НМЦ), против цены, за которую заключили договор.
          <b> Прогноз системы</b> — рост, который сервис посчитал по договорам прошлого года и данным ЦБ, МЭР и Росстата; проверяется на закупках, которые повторяются из года в год.
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
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Год" className="inp w-auto py-1 text-xl font-semibold" value={y.year} onChange={(e) => onYear(Number(e.target.value))}>
          {years.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <span className="text-xl font-semibold text-slate-900">год</span>
        <span className="hint ml-auto">Договоры {y.year} — из «<Link className="text-brand hover:underline" href={`/forecasts/${y.factFrom!.id}`}>{y.factFrom!.title}</Link>»
          {y.systemFrom && <>; прогноз системы на {y.year} — «<Link className="text-brand hover:underline" href={`/forecasts/${y.systemFrom.id}`}>{y.systemFrom.title}</Link>»</>}</span>
      </div>

      <div className="card space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">1 · Ручной прогноз: заложили в ГПЗ и что получилось</h2>
        {!m.source ? (
          <p className="text-sm text-slate-600">В файлах {y.year} года нет НМЦ — ни в ГПЗ, ни в отчётности. Нужна колонка «Начальная (максимальная) цена без НДС». Если она есть в ГПЗ, обновите файлы прогноза «{y.factFrom!.title}»: меню «⋯» → «Редактировать» → файлы.</p>
        ) : <>
          {m.source === "report" && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">НМЦ взята из отчётности — это цена на момент торгов, а не то, что закупщик планировал в ГПЗ. Чтобы проверить именно план, обновите файлы прогноза «{y.factFrom!.title}»: меню «⋯» → «Редактировать» → файлы (в ГПЗ должна быть колонка НМЦ без НДС).</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile value={signed(m.bySum)} label={`по сумме ${m.n} ${plural(m.n, "закупки", "закупок", "закупок")}: заложили ${m.bySum != null && m.bySum >= 0 ? "больше" : "меньше"}, чем потратили`} />
            <Tile value={pct(m.typical)} label="типичное отклонение по одной закупке" />
            <Tile value={m.within10 != null ? `${m.within10}${NBSP}%` : "—"} label="закупок, где НМЦ отличалась от договора не больше чем на 10 %" />
          </div>
          <p className="hint">НМЦ обычно выше цены договора — в ней запас на торги. Большое отклонение в одной закупке — повод посмотреть, как её планировали.</p>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Закупка</th><th className="text-right">Заложили (НМЦ)</th><th className="text-right">Договор</th><th className="text-right">Отклонение</th></tr></thead>
              <tbody>{(allLots ? m.lots : m.lots.slice(0, 10)).map((l, i) => (
                <tr key={i}><td>{l.subject}<span className="block text-xs text-slate-500">{[l.lot, l.region, l.unit].filter(Boolean).join(" · ")}</span></td>
                  <td className="whitespace-nowrap text-right">{rub(l.plan)}</td><td className="whitespace-nowrap text-right font-medium">{rub(l.fact)}</td>
                  <td className={`whitespace-nowrap text-right ${Math.abs(l.dev) > 20 ? "text-amber-700" : "text-slate-600"}`}>{signed(l.dev)}</td></tr>
              ))}</tbody>
            </table>
            {m.lots.length > 10 && <button className="mt-2 text-sm text-brand hover:underline" onClick={() => setAllLots(!allLots)}>{allLots ? "Свернуть" : `Показать все закупки (${m.lots.length})`}</button>}
          </div>
        </>}
      </div>

      <div className="card space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">2 · Прогноз системы против ручного — на повторяющихся закупках</h2>
        {!y.systemFrom ? (
          <p className="text-sm text-slate-600">Нет прогноза системы на {y.year} год. Создайте его из ГПЗ и отчётности {y.year - 1} года (год прогноза {y.year}, базовый {y.year - 1}).
            <Link href="/forecasts/new" className="btn-sec ml-2 inline-flex">Новый прогноз</Link></p>
        ) : !r.n ? (
          <p className="text-sm text-slate-600">Ни одна закупка не повторяется: в {y.year - 1} и {y.year} годах нет позиций с одним кодом ОКПД2 и единицей. Проверить систему на этих данных нельзя.</p>
        ) : <>
          {!enough && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">Повторяющихся закупок только {r.n} — мало для вывода. Цифры ниже — для ориентира; надёжно сравнить можно, когда их хотя бы {MIN_REPEATS}.</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile value={signed(r.fact)} label={`факт: рост цен ${y.year} к ${y.year - 1} (медиана по ${r.n} ${plural(r.n, "закупке", "закупкам", "закупкам")})`} strong />
            <Tile value={r.compared ? pct(r.manualError) : "—"} label={r.compared ? `ошибка ручного прогноза · закупщики заложили ${signed(r.manualGrowth)}` : "нет НМЦ по этим закупкам"} />
            <Tile value={pct(r.systemError)} label={`ошибка системы · система предсказала ${signed(r.systemGrowth)} (в карточке ${signed(y.systemFrom.growth)} по всем позициям)`} />
          </div>
          {r.compared > 0 && <p className="text-sm">{r.systemCloser * 2 > r.compared ? <span className="font-medium text-emerald-700">Система ближе к факту</span> : r.systemCloser * 2 < r.compared ? <span className="font-medium text-amber-700">Ручной прогноз ближе к факту</span> : <span className="text-slate-600">Поровну</span>}
            <span className="text-slate-500"> — в {r.systemCloser} из {r.compared} {plural(r.compared, "закупки", "закупок", "закупок")} система оказалась точнее. Ошибка — насколько цена отличалась от договора, меньше — лучше.</span></p>}
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Закупка</th><th className="text-right">Договор {y.year - 1}</th><th className="text-right">Договор {y.year}</th><th className="text-right">1 · Ручной</th><th className="text-right">2 · Система</th></tr></thead>
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
        </>}
      </div>
    </>
  );
}

function Tile({ value, label, strong }: { value: string; label: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl p-4 ${strong ? "bg-slate-100" : "bg-slate-50 ring-1 ring-slate-200"}`}>
      <p className="text-3xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </div>
  );
}
