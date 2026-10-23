"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/components/useReference";
import type { AccuracyRow, AccuracyStat, AccuracyYear } from "@/lib/forecasts/accuracy";

const NBSP = " ";
const pct = (x: number | null) => (x == null ? "—" : `${x.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}${NBSP}%`);
const signed = (x: number | null) => (x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}${NBSP}%`);
const rub = (x: number) => `${x.toLocaleString("ru-RU", { maximumFractionDigits: x < 100 ? 2 : 0 })}${NBSP}₽`;
const err = (p: number | null, f: number) => (p == null || !f ? null : (p / f - 1) * 100);
const biasText = (s: AccuracyStat) => (s.bias == null ? "" : Math.abs(s.bias) < 1 ? "в среднем почти совпадает с фактом" : s.bias > 0 ? `обычно выше факта на ${pct(s.bias)}` : `обычно ниже факта на ${pct(-s.bias)}`);

export default function AccuracyPage() {
  const [data, setData] = useState<AccuracyYear[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api("/api/accuracy", "GET").then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e))); }, []);

  return (
    <div className="space-y-5">
      <div>
        <div className="text-sm"><Link href="/" className="text-brand hover:underline">Прогнозы</Link> <span className="text-slate-400">›</span> Точность</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Точность прогнозов по годам</h1>
        <p className="hint mt-1 max-w-3xl">
          Сравниваем две оценки цены с тем, что получилось в договорах года. <b>Ручной прогноз</b> — цена, которую закупщики заложили в план (НМЦ из ГПЗ или отчётности).
          <b> Прогноз системы</b> — цена, которую посчитал сервис на этот год по договорам прошлого года и индексам. Чем меньше ошибка, тем точнее.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && <p className="hint">Загрузка…</p>}
      {data && data.length === 0 && <div className="card text-sm text-slate-600">Пока нет прогнозов. Загрузите ГПЗ и отчётность за год — и здесь появится сравнение.</div>}

      {data && data.some((y) => y.both) && (
        <div className="card">
          <p className="mb-2 font-semibold text-slate-900">Итог по годам — типичная ошибка</p>
          <table className="tbl">
            <thead><tr><th>Год</th><th className="text-right">Ручной прогноз (ГПЗ)</th><th className="text-right">Прогноз системы</th><th>Что точнее</th><th className="text-right">Позиций</th></tr></thead>
            <tbody>{data.filter((y) => y.both).map((y) => (
              <tr key={y.year}><td className="font-medium">{y.year}</td>
                <td className="text-right">{pct(y.both!.manual.error)}</td>
                <td className="text-right">{pct(y.both!.system.error)}</td>
                <td><Verdict y={y} /></td>
                <td className="text-right text-slate-500">{y.both!.n}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {data?.map((y) => <YearCard key={y.year} y={y} />)}
    </div>
  );
}

function Verdict({ y }: { y: AccuracyYear }) {
  const m = y.both?.manual.error, s = y.both?.system.error;
  if (m == null || s == null) return <span className="text-slate-400">—</span>;
  const d = Math.round((m - s) * 10) / 10;
  if (Math.abs(d) < 1) return <span className="text-slate-600">одинаково</span>;
  return d > 0 ? <span className="font-medium text-emerald-700">система точнее на {pct(d).replace("%", "п. п.")}</span>
    : <span className="font-medium text-amber-700">ручной точнее на {pct(-d).replace("%", "п. п.")}</span>;
}

function YearCard({ y }: { y: AccuracyYear }) {
  const [all, setAll] = useState(false);
  const man = y.both?.manual ?? y.manual, sys = y.both?.system ?? (y.system.n ? y.system : null);
  const rows = [...y.rows].sort((a, b) => Math.abs(err(b.system ?? b.manual, b.fact) ?? 0) - Math.abs(err(a.system ?? a.manual, a.fact) ?? 0));
  const shown = all ? rows : rows.slice(0, 10);
  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold text-slate-900">{y.year} год</h2>
        <p className="hint">Факт — договоры {y.year} из «<Link className="text-brand hover:underline" href={`/forecasts/${y.factFrom!.id}`}>{y.factFrom!.title}</Link>»
          {y.systemFrom && <>; прогноз системы — «<Link className="text-brand hover:underline" href={`/forecasts/${y.systemFrom.id}`}>{y.systemFrom.title}</Link>»</>}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {man.n ? <Tile n={1} title="Ручной прогноз (ГПЗ)" s={man} />
          : <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
              <p className="font-medium text-slate-900">1 · Ручной прогноз (ГПЗ)</p>
              <p className="mt-1">В файлах {y.year} года нет начальной (максимальной) цены без НДС — ни в ГПЗ, ни в отчётности. Без неё не с чем сравнить.</p>
            </div>}
        {sys ? <Tile n={2} title="Прогноз системы" s={sys} />
          : <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
              <p className="font-medium text-slate-900">2 · Прогноз системы</p>
              {y.systemFrom
                ? <p className="mt-1">В прогнозе «{y.systemFrom.title}» нет тех же позиций (код ОКПД2, регион и единица), что в договорах {y.year} года — сравнивать не с чем.</p>
                : <>
                  <p className="mt-1">Нет прогноза на {y.year} год. Создайте его из ГПЗ и отчётности {y.year - 1} года (год прогноза {y.year}) — и здесь появится вторая цифра.</p>
                  <Link href="/forecasts/new" className="btn-sec mt-3 inline-flex">Новый прогноз</Link>
                </>}
            </div>}
      </div>
      {y.both && <p className="text-sm"><Verdict y={y} /> <span className="text-slate-500">— сравнение на {y.both.n} одинаковых позициях, где есть все три цены.</span></p>}
      {!y.both && sys && y.manual.n > 0 && <p className="hint">Нет позиций, где есть и ручная цена, и прогноз системы — сравнить на одних и тех же позициях нельзя.</p>}
      <p className="hint">Ручная цена — это НМЦ: в неё обычно заложен запас на торги, поэтому она чаще выше факта.</p>

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Позиция</th><th className="text-right">Факт {y.year}</th><th className="text-right">1 · Ручной</th><th className="text-right">2 · Система</th></tr></thead>
            <tbody>{shown.map((r, i) => <Row key={i} r={r} />)}</tbody>
          </table>
          {rows.length > 10 && <button className="mt-2 text-sm text-brand hover:underline" onClick={() => setAll(!all)}>{all ? "Свернуть" : `Показать все позиции (${rows.length})`}</button>}
        </div>
      )}
    </div>
  );
}

function Tile({ n, title, s }: { n: number; title: string; s: AccuracyStat }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <p className="text-sm font-medium text-slate-700">{n} · {title}</p>
      <p className="mt-1 text-3xl font-semibold text-slate-900">{pct(s.error)}</p>
      <p className="text-xs text-slate-500">типичная ошибка{s.n ? ` · ${s.n} позиций` : ""}{s.bias != null ? ` · ${biasText(s)}` : ""}</p>
    </div>
  );
}

function Row({ r }: { r: AccuracyRow }) {
  const cell = (p: number | null) => {
    const e = err(p, r.fact);
    return <td className="whitespace-nowrap text-right">{p == null ? <span className="text-slate-400">—</span> : <>{rub(p)}<span className={`block text-xs ${e != null && Math.abs(e) > 20 ? "text-amber-700" : "text-slate-500"}`}>{signed(e)}</span></>}</td>;
  };
  return (
    <tr>
      <td>{r.subject}<span className="block text-xs text-slate-500">{[r.region, r.unit, r.okpd2].filter(Boolean).join(" · ")}</span></td>
      <td className="whitespace-nowrap text-right font-medium">{rub(r.fact)}</td>
      {cell(r.manual)}{cell(r.system)}
    </tr>
  );
}
