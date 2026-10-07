"use client";
import { useMemo, useState } from "react";
import { parseGpz, parseReport } from "@/lib/parse";
import { buildForecast, type ForecastResult } from "@/lib/forecast";
import { downloadWorkbook, forecastWorkbook } from "@/lib/excel";
import { api, useReference } from "@/components/useReference";

const fmt = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

export default function ForecastPage() {
  const { reference, db, error } = useReference();
  const [gpz, setGpz] = useState<File | null>(null);
  const [rep, setRep] = useState<File | null>(null);
  const [baseYear, setBaseYear] = useState(2026);
  const [res, setRes] = useState<ForecastResult | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [q, setQ] = useState("");

  async function run() {
    if (!gpz || !rep || !reference) return;
    setBusy(true); setMsg(null); setRes(null);
    try {
      const codes = reference.regions.map((r) => r.code);
      const g = parseGpz(await gpz.arrayBuffer(), codes);
      const r = parseReport(await rep.arrayBuffer());
      const result = buildForecast(g.rows, r.rows, reference, { baseYear, targetYear: baseYear + 1 });
      setRes(result);
      if (result.newWsCodes.length && db) {
        await api("/api/ws/auto", "POST", { codes: result.newWsCodes });
        setMsg(`В справочник WS добавлены новые коды: ${result.newWsCodes.join(", ")}`);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const shown = useMemo(() => (res?.rows ?? []).filter((r) =>
    (!onlyFlagged || r.needsApproval) &&
    (!q || `${r.okpd2} ${r.subject} ${r.category ?? ""} ${r.regionName ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [res, onlyFlagged, q]);

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h1 className="text-lg font-semibold">Прогноз цен на {baseYear + 1} год</h1>
        <p className="text-sm text-slate-600">Файлы читаются в браузере и не передаются на сервер. С сервера загружаются только справочники и индексы.</p>
        {error && <p className="text-sm text-red-700">{error}</p>}
        {db === false && <p className="text-sm text-amber-700">База данных не подключена — используются встроенные справочники.</p>}
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">ГПЗ {baseYear} (.xlsx)<input type="file" accept=".xlsx,.xls" className="mt-1 block w-full text-sm" onChange={(e) => setGpz(e.target.files?.[0] ?? null)} /></label>
          <label className="text-sm">Отчётность {baseYear} (.xlsx)<input type="file" accept=".xlsx,.xls" className="mt-1 block w-full text-sm" onChange={(e) => setRep(e.target.files?.[0] ?? null)} /></label>
          <label className="text-sm">Базовый год<input type="number" className="inp mt-1" value={baseYear} onChange={(e) => setBaseYear(Number(e.target.value))} /></label>
        </div>
        <div className="flex gap-2">
          <button className="btn" disabled={!gpz || !rep || !reference || busy} onClick={run}>{busy ? "Расчёт…" : "Рассчитать прогноз"}</button>
          {res && reference && <button className="btn-sec" onClick={() => downloadWorkbook(forecastWorkbook(res, reference.sources, baseYear + 1), `Прогноз_цен_${baseYear + 1}.xlsx`)}>Скачать Excel</button>}
        </div>
        {msg && <p className="text-sm text-slate-700">{msg}</p>}
      </div>

      {res && (
        <div className="card space-y-3">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span>Строк ГПЗ: <b>{res.stats.gpz}</b></span>
            <span>Найдено в отчётности: <b>{res.stats.matched}</b></span>
            <span>Договоров в расчёте: <b>{res.stats.used}</b></span>
            <span>Позиций прогноза: <b>{res.rows.length}</b></span>
            <span>Требуют согласования: <b>{res.rows.filter((r) => r.needsApproval).length}</b></span>
            <label className="ml-auto flex items-center gap-1"><input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />только требующие согласования</label>
            <input className="inp max-w-xs" placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="max-h-[60vh] overflow-auto">
            <table className="tbl">
              <thead><tr><th>ОКПД2</th><th>Предмет</th><th>Регион</th><th>Ед.</th><th>Дог.</th><th>Цена {baseYear}, ₽</th><th>Индекс</th><th>Прогноз {baseYear + 1}, ₽</th><th>Отметки</th><th>Комментарий</th></tr></thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={i} className={r.needsApproval ? "bg-amber-50" : ""}>
                    <td>{r.okpd2}</td><td>{r.subject}</td><td>{r.regionName ?? r.region}</td><td>{r.unit}</td>
                    <td className="text-right">{r.contracts}</td><td className="text-right">{fmt(r.basePrice)}</td>
                    <td className="text-right">{r.forecastIndex.toFixed(3)}</td><td className="text-right font-medium">{fmt(r.forecastPrice)}</td>
                    <td>{r.flags.map((f) => <span key={f} className="tag">{f}</span>)}</td>
                    <td className="text-xs text-slate-600">{r.comment}{r.indexSourceUrl && <> · <a className="text-blue-700 underline" href={r.indexSourceUrl} target="_blank" rel="noreferrer">{r.indexSource}</a></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {res.excluded.length > 0 && (
            <details className="text-sm"><summary className="cursor-pointer">Не вошли в расчёт: {res.excluded.length}</summary>
              <table className="tbl mt-2"><thead><tr><th>Файл</th><th>Строка</th><th>Лот / ID</th><th>Причина</th></tr></thead>
                <tbody>{res.excluded.slice(0, 500).map((e, i) => <tr key={i}><td>{e.file}</td><td>{e.row}</td><td>{e.lot}</td><td>{e.reason}</td></tr>)}</tbody></table>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
