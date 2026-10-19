"use client";
import { useEffect, useState } from "react";
import { api } from "./useReference";
import { unpackPoint, type PackedPoint } from "@/lib/forecast";
import { fmtGrowth, fmtRub, plural } from "@/lib/forecastView";

interface HistoryRow { number: number; created_at: string; comment: string | null; contracts: number; base_price: number; forecast_price: number; raw_median: number | null; manually_edited: boolean; index_key: string | null; index_level: string | null }
interface EditRow { created_at: string; version: number | null; event_type: string; field: string | null; old_value: string | null; new_value: string | null; reason: string | null; author: string }
interface ItemResp { data: { pts?: PackedPoint[]; prices?: number[]; outlierPrices?: number[]; unitLabel?: string; regionName?: string | null }; history: HistoryRow[]; edits: EditRow[] }

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("ru-RU") : "—");
const num = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

/** Договоры, по которым посчитана позиция, и её история по версиям прогноза */
export function PositionDetails({ itemId, baseYear }: { itemId: number; baseYear: number }) {
  const [d, setD] = useState<ItemResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api(`/api/items/${itemId}`, "GET").then(setD).catch((e) => setErr(e instanceof Error ? e.message : String(e))); }, [itemId]);
  if (err) return <p className="text-sm text-red-600">{err}</p>;
  if (!d) return <p className="hint">Загрузка договоров…</p>;
  const pts = (d.data.pts ?? []).map(unpackPoint);
  const unit = d.data.unitLabel ?? "ед";
  const outliers = new Set((d.data.outlierPrices ?? []).map((x) => Math.round(x)));
  const th = "whitespace-nowrap px-2 py-1.5 text-left text-[11px] font-medium uppercase text-slate-500";
  const td = "border-t border-slate-100 px-2 py-1.5 align-top";
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-slate-900">Договоры в основе расчёта ({pts.length})</p>
        {!pts.length ? <p className="hint">Список договоров сохраняется при загрузке файлов — у этой версии его нет.</p> : (
          <>
            {!pts.some((p) => p.lot) && <p className="hint">Номера лотов и даты сохраняются только для прогнозов, загруженных заново.</p>}
            <div className="mt-1 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-slate-50"><tr>
                  <th className={th}>Лот / процедура</th><th className={th}>Предмет (из ГПЗ)</th><th className={`${th} text-right`}>Кол-во</th>
                  <th className={`${th} text-right`}>Сумма договора без НДС</th><th className={`${th} text-right`}>Цена за {unit}</th>
                  <th className={th}>Срок</th><th className={`${th} text-right`}>Мес. в {baseYear} / позже</th><th className={`${th} text-right`}>Цена {baseYear} за {unit}</th>
                </tr></thead>
                <tbody>{pts.map((p, i) => {
                  const sum = p.raw * (p.qty ?? 0);
                  const later = p.mAfter ?? 0;
                  return (
                    <tr key={i} className={outliers.has(Math.round(p.raw)) ? "text-slate-400" : ""}>
                      <td className={`${td} whitespace-nowrap`}>{p.lot ?? "—"}</td>
                      <td className={td}>{"subject" in p && p.subject ? String(p.subject) : "—"}</td>
                      <td className={`${td} whitespace-nowrap text-right`}>{p.qty != null ? num(p.qty) : "—"}</td>
                      <td className={`${td} whitespace-nowrap text-right`}>{p.qty ? fmtRub(sum) : "—"}</td>
                      <td className={`${td} whitespace-nowrap text-right`}>{fmtRub(p.raw)}</td>
                      <td className={`${td} whitespace-nowrap`}>{p.start || p.end ? `${fmtDate(p.start)} – ${fmtDate(p.end)}` : p.month ? `заключён ${String(p.month).padStart(2, "0")}.${p.year ?? baseYear}` : "—"}</td>
                      <td className={`${td} whitespace-nowrap text-right`}>{p.mBase != null ? `${p.mBase} / ${later}` : "—"}</td>
                      <td className={`${td} whitespace-nowrap text-right`}>{fmtRub(p.raw * (p.share ?? 1))}{p.share && <span className="block text-[10px] text-slate-400">× {num(p.share)}</span>}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Серым — договоры, не вошедшие в медиану (цена отличается больше чем в 2 раза). Если договор заходит на следующий год, месяцы после {baseYear} года считаются по новой цене: цена {baseYear} = сумма / (месяцы {baseYear} + месяцы позже × (1 + рост цен)).</p>
          </>
        )}
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-900">История позиции по версиям</p>
        <div className="mt-1 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50"><tr><th className={th}>Версия</th><th className={th}>Что произошло</th><th className={`${th} text-right`}>Договоров</th><th className={`${th} text-right`}>Цена договоров</th><th className={`${th} text-right`}>Прогноз</th><th className={`${th} text-right`}>Рост</th></tr></thead>
            <tbody>{d.history.map((h) => {
              const base = h.raw_median || h.base_price;
              return (
                <tr key={h.number}>
                  <td className={`${td} whitespace-nowrap`}>v{h.number}<span className="block text-[10px] text-slate-400">{fmtDate(h.created_at)}</span></td>
                  <td className={td}>{h.comment ?? ""}{h.manually_edited && <span className="ml-1 text-amber-700">· цена изменена вручную</span>}</td>
                  <td className={`${td} text-right`}>{h.contracts}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>{fmtRub(base)}</td>
                  <td className={`${td} whitespace-nowrap text-right font-semibold`}>{fmtRub(h.forecast_price)}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>{fmtGrowth(Math.round((h.forecast_price / base - 1) * 1000) / 10)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        {d.edits.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {d.edits.map((e, i) => <li key={i}>{fmtDate(e.created_at)}{e.version ? ` · v${e.version}` : ""} · {e.field === "reviewed" ? "проверка" : "правка"}: {e.old_value ?? "—"} → <b>{e.new_value ?? "—"}</b>{e.reason ? ` — ${e.reason}` : ""} ({e.author})</li>)}
          </ul>
        )}
        {d.history.length <= 1 && !d.edits.length && <p className="mt-1 hint">Позиция есть только в этой версии, правок не было.</p>}
        <p className="mt-1 text-[11px] text-slate-500">{d.history.length} {plural(d.history.length, "версия", "версии", "версий")} прогноза.</p>
      </div>
    </div>
  );
}
