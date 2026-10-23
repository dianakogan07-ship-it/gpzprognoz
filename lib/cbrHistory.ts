import * as XLSX from "xlsx";

/** История макроэкономических опросов Банка России («Агрегированные результаты опроса», xlsx): медианы ИПЦ в среднем за год */
export interface CbrHistory {
  /** Опросы по дате выхода: ISO-дата → год прогноза → медиана, % */
  surveys: { date: string; values: Record<number, number> }[];
}

const fromSerial = (n: number) => new Date(Date.UTC(1899, 11, 30) + n * 864e5);
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
export const surveyTitle = (iso: string) => { const d = new Date(iso); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
export const surveyTitleGen = (iso: string) => { const d = new Date(iso); return `${MONTHS_GEN[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

export function parseCbrHistory(buf: ArrayBuffer): CbrHistory {
  const wb = XLSX.read(buf, { type: "array" });
  // Лист ИПЦ в среднем за год: в заголовке «ИПЦ» и «в среднем за год»
  const name = wb.SheetNames.find((n) => {
    const head = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: true }).slice(0, 6).flat().map(String).join(" ");
    return /агрегирован/i.test(head) && /ИПЦ/.test(head) && /в\s+среднем\s+за\s+год/i.test(head);
  });
  if (!name) throw new Error("В файле нет листа «ИПЦ, в среднем за год» — это точно «Агрегированные результаты опроса» Банка России?");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true });
  const di = rows.findIndex((r) => r.filter((c, i) => i >= 3 && typeof c === "number" && c > 40000).length >= 3);
  if (di < 0) throw new Error("Не найдена строка с датами опросов");
  const dates = rows[di].map((c, i) => (i >= 3 && typeof c === "number" ? fromSerial(c).toISOString().slice(0, 10) : null));
  const mi = rows.findIndex((r) => /медиана/i.test(String(r[0] ?? "")));
  if (mi < 0) throw new Error("Не найден блок «Медиана»");
  const surveys = new Map<string, Record<number, number>>();
  for (let i = mi; i < rows.length && (i === mi || !rows[i][0]); i++) {
    const y = rows[i][2];
    if (typeof y !== "number") continue;
    const year = fromSerial(y).getUTCFullYear();
    rows[i].forEach((v, j) => {
      if (j < 3 || typeof v !== "number" || !dates[j]) return;
      const m = surveys.get(dates[j]!) ?? {};
      m[year] = Math.round(v * 10) / 10;
      surveys.set(dates[j]!, m);
    });
  }
  return { surveys: [...surveys.entries()].map(([date, values]) => ({ date, values })).sort((a, b) => a.date.localeCompare(b.date)) };
}

/** Опрос, по которому делался прогноз на год: последний вышедший до ноября предыдущего года (когда составляется ГПЗ) */
export function surveyFor(h: CbrHistory, year: number) {
  const before = h.surveys.filter((s) => s.values[year] != null && s.date < `${year - 1}-11-01`);
  return before[before.length - 1] ?? h.surveys.filter((s) => s.values[year] != null)[0] ?? null;
}
