import { cleanText, type Page } from "./mer/grid";

/** Макроэкономический опрос Банка России: медианы прогнозов по годам */
export interface CbrSurvey {
  /** «14 октября 2026 года» — дата опроса */
  date: string | null;
  /** Инфляция в среднем за год, %: год → значение; facts — годы с пометкой «факт» */
  cpiAvg: Record<number, number>;
  /** Значения прошлого опроса (в скобках) */
  cpiAvgPrev: Record<number, number>;
  facts: number[];
}

const NUM = /^[-−–]?\d+(,\d+)?$/;
const PAREN = /^\([-−–]?\d+(,\d+)?\)$/;
const toNum = (s: string) => Number(s.replace(/[()]/g, "").replace(/[−–]/, "-").replace(",", "."));

/** Разбор PDF-выгрузки опроса: строка значений идёт перед подписью показателя, под ней — значения прошлого опроса в скобках */
export function parseCbrSurvey(pages: Page[]): CbrSurvey {
  const rows = pages.flatMap((p) => p.rows.map((r) => r.cells.map((c) => ({ text: cleanText(c.text), x: c.x })).filter((c) => c.text)));
  const all = rows.map((r) => r.map((c) => c.text).join(" ")).join("\n");
  const date = all.match(/\d{1,2}\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+\d{4}\s+года/i)?.[0] ?? null;
  const hi = rows.findIndex((r) => r.filter((c) => /^20\d\d$/.test(c.text)).length >= 4);
  if (hi < 0) throw new Error("В файле не найдена таблица с годами — это точно результаты макроэкономического опроса Банка России?");
  const years = rows[hi].filter((c) => /^20\d\d$/.test(c.text)).map((c) => ({ year: Number(c.text), x: c.x }));
  const gap = Math.min(...years.slice(1).map((y, i) => y.x - years[i].x));
  const yearAt = (x: number) => {
    const y = years.reduce((b, c) => (Math.abs(c.x - x) < Math.abs(b.x - x) ? c : b));
    return Math.abs(y.x - x) <= gap * 0.6 ? y.year : null;
  };
  // Годы с пометкой «факт» — в строке под годами
  const facts = (rows[hi + 1] ?? []).filter((c) => /факт/i.test(c.text)).map((c) => yearAt(c.x)).filter((y): y is number => y != null);

  const isValues = (r: typeof rows[number]) => r.length >= 3 && r.every((c) => NUM.test(c.text));
  for (let i = hi + 1; i < rows.length; i++) {
    if (!isValues(rows[i])) continue;
    let j = i + 1, label = "";
    const prev: Record<number, number> = {};
    while (j < rows.length && !isValues(rows[j]) && j < i + 8) {
      for (const c of rows[j]) {
        if (PAREN.test(c.text)) { const y = yearAt(c.x); if (y) prev[y] = toNum(c.text); }
        else label += ` ${c.text}`;
      }
      j++;
    }
    if (/(ИПЦ|инфляц)/i.test(label) && /в\s+среднем\s+за\s+год/i.test(label) && !/дек\S*\s+к\s+дек/i.test(label)) {
      const cpiAvg: Record<number, number> = {};
      for (const c of rows[i]) { const y = yearAt(c.x); if (y) cpiAvg[y] = toNum(c.text); }
      return { date, cpiAvg, cpiAvgPrev: prev, facts };
    }
  }
  throw new Error("В таблице опроса не найдена строка «ИПЦ, в среднем за год»");
}
