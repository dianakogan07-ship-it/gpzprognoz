/**
 * Надбавка закупщиков: на сколько НМЦ в ГПЗ была выше цены заключённого договора (медиана по закупкам года).
 * Рекомендуемая НМЦ: сначала цена растёт по индексам, затем на выросшую цену — средняя надбавка прошлых лет: (1 + рост) × (1 + надбавка) − 1.
 */
export interface ReserveYear { year: number; overall: number | null; byCat: Record<string, { n: number; reserve: number }> }
export interface Reserve {
  /** Годы, по которым посчитана надбавка, и её значение в каждом */
  years: { year: number; value: number }[];
  /** Среднее по годам, % */
  overall: number | null;
  /** По категориям: среднее по годам, где категория была */
  byCat: Record<string, number>;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

/** Надбавка для прогноза с базовым годом upTo — по всем годам до него включительно */
export function reserveFor(all: ReserveYear[] | null | undefined, upTo: number): Reserve | null {
  const ys = (all ?? []).filter((y) => y.year <= upTo && y.overall != null).sort((a, b) => a.year - b.year);
  if (!ys.length) return null;
  const cats = new Map<string, number[]>();
  for (const y of ys) for (const [k, v] of Object.entries(y.byCat)) cats.set(k, [...(cats.get(k) ?? []), v.reserve]);
  return {
    years: ys.map((y) => ({ year: y.year, value: y.overall! })),
    overall: r1(ys.reduce((s, y) => s + y.overall!, 0) / ys.length),
    byCat: Object.fromEntries([...cats].map(([k, v]) => [k, r1(v.reduce((s, x) => s + x, 0) / v.length)])),
  };
}

/** Рекомендуемая НМЦ: рост к ценам договоров базового года, % */
export const nmcGrowth = (growth: number, reserve: number) => r1(((1 + growth / 100) * (1 + reserve / 100) - 1) * 100);

/** «2024 — 0 %, 2025 — +3,6 %» */
export const reserveYearsText = (r: Reserve) =>
  r.years.map((y) => `${y.year}: ${y.value > 0 ? "+" : y.value < 0 ? "−" : ""}${Math.abs(y.value).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} %`).join(", ");
