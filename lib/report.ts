import { contractPrice, type ForecastRow } from "./forecast";

/** Цвета отчёта */
export const RC = {
  navy: "#141A7A", sky: "#4FB3F5", blue: "#1F4FD8", violet: "#7B5CE6", teal: "#0F8A6A",
  bg: "#F2F4F8", ink: "#141827", ink2: "#4A5168", muted: "#7D849A", line: "#E4E7EF", track: "#EEF0F6", span: "#C9D6F7", warn: "#B45309",
} as const;

/** Сумма договоров позиции без НДС (цена × количество из ГПЗ); в версиях без количества — null */
export const sumBase = (r: ForecastRow) => (r.baseSum != null && r.volume ? r.baseSum : null);
/** Та же потребность по ценам прогноза: учитывает и ручные правки цены */
export const sumForecast = (r: ForecastRow) => {
  const b = sumBase(r);
  return b == null ? null : b * (r.forecastPrice / contractPrice(r));
};

/** Все позиции с суммой закупки — тогда рост взвешивается по деньгам, иначе по цене за единицу */
const byMoney = (rows: ForecastRow[]) => rows.length > 0 && rows.every((r) => sumBase(r) != null);

/**
 * Средний рост группы — та же формула, что «средний рост» в шапке прогноза, %.
 * Есть суммы — сумма потребности по прогнозу к сумме договоров; нет — сумма прогнозов к сумме цен договоров.
 * Включает и рост внутри базового года, и рост отрасли: (1 + рост до последнего месяца) × (1 + рост отрасли) − 1
 */
export function avgGrowth(rows: ForecastRow[]): number {
  const money = byMoney(rows);
  const base = rows.reduce((s, r) => s + (money ? sumBase(r)! : contractPrice(r)), 0);
  const fc = rows.reduce((s, r) => s + (money ? sumForecast(r)! : r.forecastPrice), 0);
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
  const w = (r: ForecastRow) => (byMoney(rows) ? sumBase(r)! : 1);
  const wsum = rows.reduce((s, r) => s + w(r), 0) || 1;
  const a = rows.reduce((s, r) => s + w(r) * intraYear(r), 0) / wsum;
  const b = rows.reduce((s, r) => s + w(r) * industry(r), 0) / wsum;
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

/** Максимум шкалы колец: не меньше 10 %, с запасом в полтора раза над самым большим ростом */
export const radialMax = (maxTotal: number) => Math.max(10, Math.ceil(Math.max(0, maxTotal)) * 1.5);

/** Число по-русски: запятая, неразрывные пробелы */
export const fmtNum = (n: number, d = 1) => n.toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/\s/g, " ");
export const fmtPct = (n: number, sign = true) => `${sign ? (n < 0 ? "−" : "+") : n < 0 ? "−" : ""}${fmtNum(Math.abs(n))} %`;
export const fmtMoney = (v: number) => (Math.abs(v) >= 1e9 ? `${fmtNum(v / 1e9)} млрд ₽` : Math.abs(v) >= 1e6 ? `${fmtNum(v / 1e6)} млн ₽` : fmtRubInt(v));
export const fmtRubInt = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, " ")} ₽`;

/** Короткое название региона для подписей графиков */
export function shortRegion(name: string): string {
  const fixed: Record<string, string> = {
    "г. Санкт-Петербург": "СПб", "г. Москва": "Москва", "г. Севастополь": "Севастополь",
    "Ханты-Мансийский автономный округ — Югра": "ХМАО — Югра", "Ямало-Ненецкий автономный округ": "ЯНАО",
    "Ненецкий автономный округ": "НАО", "Чукотский автономный округ": "Чукотка", "Еврейская автономная область": "ЕАО",
    "Кемеровская область — Кузбасс": "Кемеровская", "Республика Северная Осетия — Алания": "Сев. Осетия",
  };
  if (fixed[name]) return fixed[name];
  return name.replace(/\s+область$/, "").replace(/\s+край$/, "").replace(/^Республика\s+/, "").replace(/\s+Республика$/, "");
}

/** Отметки оси от min до max с шагом step */
export const ticks = (min: number, max: number, step: number) => {
  const out: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
};
