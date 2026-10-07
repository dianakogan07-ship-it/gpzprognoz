import { aggregateForecast, findIndex, okvedSection } from "./forecast";
import { isActiveIndex, type PriceIndex, type Reference, type Source } from "./types";

/** Ставка НДС по умолчанию, если в файлах её нет */
export const DEFAULT_VAT = 0.22;

/**
 * Последний месяц, до которого Росстат опубликовал данные за год:
 * коэффициенты есть для месяцев договора до него, сам месяц — точка пересчёта.
 */
export function lastDataMonth(indices: PriceIndex[], year: number): number | null {
  const months = indices.filter((i) => i.kind === "to_december" && i.year === year && isActiveIndex(i) && i.month).map((i) => i.month!);
  return months.length ? Math.min(12, Math.max(...months) + 1) : null;
}

export interface IndexRef { value: number; key: string | null; approved: boolean; source: Source | null; note: string | null }
const refOf = (ix: PriceIndex, ref: Reference): IndexRef => ({
  value: ix.value, key: ix.key, approved: ix.approved, note: ix.note,
  source: ix.source_code ? ref.sources.find((s) => s.code === ix.source_code) ?? null : null,
});

/** Пример расчёта одного договора по действующим индексам — тем же кодом, что и прогноз */
export function explainExample(ref: Reference, p: { okpd2: string; month: number; price: number; vat: number }, baseYear: number, targetYear: number) {
  const active = ref.indices.filter(isActiveIndex);
  const section = okvedSection(p.okpd2, ref);
  const toDecList = active.filter((i) => i.kind === "to_december" && i.year === baseYear);
  const toDecHit = findIndex(toDecList.filter((i) => i.month === p.month), p.okpd2, section);
  const growthHit = findIndex(active.filter((i) => i.kind === "forecast" && i.year === targetYear), p.okpd2, section);
  const cpi = active.find((i) => i.kind === "cpi" && i.year === targetYear) ?? null;
  const [row] = aggregateForecast([{ okpd2: p.okpd2, unit: "шт", region: null, ws: null, category: null, method: null, subject: "", raw: p.price, month: p.month, vat: p.vat }], ref, { baseYear, targetYear });
  return {
    lastMonth: lastDataMonth(ref.indices, baseYear),
    /** Индексы пересчёта внутри года не загружены — шаг пропускается */
    toDecOff: !toDecList.length,
    toDec: toDecHit ? refOf(toDecHit.index, ref) : null,
    growth: growthHit ? { ...refOf(growthHit.index, ref), level: growthHit.level } : null,
    cpi: cpi ? refOf(cpi, ref) : null,
    basePrice: row.basePrice,
    forecastIndex: row.forecastIndex,
    forecastPrice: row.forecastPrice,
    needsApproval: row.needsApproval,
    withVat: Math.round(row.forecastPrice * (1 + p.vat) * 100) / 100,
  };
}
