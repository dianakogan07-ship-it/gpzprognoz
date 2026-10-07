import type { IndexKind, Reference } from "./types";

/** Подписи видов индекса для интерфейса и файлов Excel */
export const KIND_LABEL: Record<IndexKind, string> = {
  forecast: "Рост по отрасли",
  cpi: "Общая инфляция",
  to_december: "Пересчёт до декабря",
};

export const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

/** 1.04 → «+4,0 %», 0.98 → «−2,0 %» */
export function formatGrowth(k: number): string {
  const p = (k - 1) * 100;
  const abs = Math.abs(p).toFixed(1).replace(".", ",");
  return `${p < -0.0001 ? "−" : "+"}${abs} %`;
}

export const coefToPercent = (k: number) => Math.round((k - 1) * 100 * 1000) / 1000;
export const percentToCoef = (p: number) => Math.round((1 + p / 100) * 100000) / 100000;

/** Название отрасли по коду: ОКПД2 (с подъёмом к родительскому коду) или раздел ОКВЭД2 */
export function industryName(key: string | null, ref: Pick<Reference, "okpd2" | "okved2">): string | null {
  if (!key) return null;
  if (/^[A-Za-z]$/.test(key)) return ref.okved2.find((s) => s.letter === key.toUpperCase())?.name ?? null;
  return ref.okpd2.find((o) => o.code === key)?.name ?? null;
}

export function industryLabel(key: string | null, ref: Pick<Reference, "okpd2" | "okved2">): string {
  if (!key) return "—";
  const name = industryName(key, ref);
  return name ? `${key} — ${name}` : key;
}

/** Сводка покрытия прогноза, сохраняется после расчёта на странице «Прогноз цен» (только счётчики, без данных закупок) */
export interface Coverage { total: number; industry: number; cpi: number; none: number; targetYear: number; at: string }
export const COVERAGE_KEY = "gpz_forecast_coverage";
