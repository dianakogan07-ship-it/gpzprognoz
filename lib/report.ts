import type { ForecastRow } from "./forecast";

/** Цвета отчёта */
export const RC = {
  navy: "#101A7A", blue: "#1E4FD8", sky: "#4FB3F6", violet: "#7B5CE6", teal: "#14B8A6",
  bg: "#F2F4F8", ink: "#141B34", muted: "#5B6478", track: "#E6EAF2",
} as const;

/** Средний рост группы — та же формула, что «средний рост» в шапке прогноза: сумма прогнозов к сумме цен, % */
export function avgGrowth(rows: ForecastRow[]): number {
  const base = rows.reduce((s, r) => s + r.basePrice, 0);
  const fc = rows.reduce((s, r) => s + r.forecastPrice, 0);
  return base ? (fc / base - 1) * 100 : 0;
}

/** Рост внутри года по позиции: пересчёт до последнего месяца с данными; без пересчёта — 0 */
export const intraYear = (r: ForecastRow) =>
  (r.toDecember === "applied" || r.toDecember === "partial") && r.rawMedian > 0 ? r.basePrice / r.rawMedian - 1 : 0;
/** Рост отрасли по позиции */
export const industry = (r: ForecastRow) => (r.basePrice > 0 ? r.forecastPrice / r.basePrice - 1 : 0);

export interface Split {
  /** Итог, % — совпадает с avgGrowth */
  total: number;
  /** Вклад роста цен внутри базового года, п.п. */
  intra: number;
  /** Вклад роста отрасли, п.п.; intra + industry = total */
  industry: number;
}

/**
 * Раскладка среднего роста на две части. Компоненты — средние по позициям.
 * Если их произведение расходится с итогом больше чем на 0,1 п.п., итог делится пропорционально логарифмам.
 * Вклады считаются в п.п. от цены договоров, поэтому их сумма точно равна итогу.
 */
export function splitGrowth(rows: ForecastRow[]): Split {
  const total = avgGrowth(rows);
  if (!rows.length) return { total: 0, intra: 0, industry: 0 };
  const a = rows.reduce((s, r) => s + intraYear(r), 0) / rows.length;
  const b = rows.reduce((s, r) => s + industry(r), 0) / rows.length;
  const t = total / 100;
  let a1 = a;
  if (Math.abs((1 + a) * (1 + b) - 1 - t) > 0.001) {
    const la = Math.log(1 + a), lb = Math.log(1 + b);
    a1 = Math.abs(la + lb) > 1e-9 && la * lb >= 0 ? Math.exp(Math.log(1 + t) * (la / (la + lb))) - 1 : Math.min(a, t);
  }
  return { total, intra: a1 * 100, industry: total - a1 * 100 };
}

/** Группировка строк по ключу с раскладкой роста */
export function groupSplit(rows: ForecastRow[], key: (r: ForecastRow) => string) {
  const m = new Map<string, ForecastRow[]>();
  for (const r of rows) { const k = key(r); m.get(k)?.push(r) ?? m.set(k, [r]); }
  return [...m.entries()].map(([k, rs]) => ({ key: k, rows: rs, ...splitGrowth(rs) })).sort((x, y) => y.total - x.total);
}

/** Максимум шкалы: максимальный рост, округлённый вверх до чётного % */
export const evenCeil = (x: number) => Math.max(2, Math.ceil(x / 2) * 2);

/** Число по-русски: запятая, неразрывные пробелы */
export const fmtNum = (n: number, d = 1) => n.toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/\s/g, " ");
export const fmtPct = (n: number, sign = true) => `${sign ? (n < 0 ? "−" : "+") : n < 0 ? "−" : ""}${fmtNum(Math.abs(n))} %`;
export const fmtRubInt = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, " ")} ₽`;
