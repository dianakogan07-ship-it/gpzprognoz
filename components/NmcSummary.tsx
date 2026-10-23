"use client";
import { useEffect, useState } from "react";
import { nmcGrowth, reserveFor, reserveYearsText, type Reserve, type ReserveYear } from "@/lib/forecasts/reserve";

const NBSP = " ";
export const pctSigned = (x: number | null | undefined) =>
  x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}${NBSP}%`;

let cache: Promise<ReserveYear[]> | null = null;
/** Надбавка закупщиков по годам — один запрос на страницу */
export function useReserve(baseYear: number | null | undefined): Reserve | null {
  const [all, setAll] = useState<ReserveYear[] | null>(null);
  useEffect(() => {
    cache ??= fetch("/api/accuracy/reserve").then((r) => r.json()).then((j) => (Array.isArray(j) ? j : [])).catch(() => []);
    cache.then(setAll);
  }, []);
  return baseYear ? reserveFor(all, baseYear) : null;
}

/** Три главные цифры: рост по индексам, надбавка закупщиков прошлых лет и рекомендуемая НМЦ */
export function NmcSummary({ growth, reserve, year, baseYear, compact }: { growth: number; reserve: Reserve | null; year: number; baseYear: number; compact?: boolean }) {
  const r = reserve?.overall ?? null;
  const tiles: [string, string, string, boolean?][] = [
    [`Рост цен по индексам на ${year}`, pctSigned(growth), `прогноз МЭР, Банка России и Росстата к ценам договоров ${baseYear}`],
    ["Надбавка закупщиков", pctSigned(r), r == null ? "нет данных — загрузите ГПЗ и отчётность прошлых лет" : `на столько НМЦ в ГПЗ была выше заключённых договоров (${reserveYearsText(reserve!)}), в среднем`],
    [`Рекомендуемая НМЦ на ${year}`, pctSigned(r == null ? growth : nmcGrowth(growth, r)), r == null ? "= рост по индексам: надбавки прошлых лет нет" : `к ценам договоров ${baseYear}: рост по индексам + надбавка`, true],
  ];
  return (
    <div className={`grid gap-2 ${compact ? "grid-cols-3" : "sm:grid-cols-3"}`}>
      {tiles.map(([t, v, note, accent]) => (
        <div key={t} className={`min-w-0 rounded-lg px-3 py-2 ${accent ? "bg-brand-light ring-1 ring-brand/20" : "bg-slate-50"}`}>
          <p className={`${compact ? "text-[11px] leading-tight" : "text-xs"} text-slate-500`}>{compact ? t.replace(/ на \d{4}$/, "") : t}</p>
          <p className={`${compact ? "text-lg" : "text-2xl"} font-semibold text-slate-900`}>{v}</p>
          {!compact && <p className="text-xs text-slate-500">{note}</p>}
        </div>
      ))}
    </div>
  );
}
