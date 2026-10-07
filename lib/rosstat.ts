import * as XLSX from "xlsx";
import { MONTHS } from "./indexFormat";

export const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** Индексы цен производителей одного вида деятельности: накопленный рост к декабрю прошлого года по месяцам */
export interface IcpSeries { key: string; name: string; values: (number | null)[] }

export interface RosstatParse {
  year: number;
  sheet: string;
  /** Последний месяц с данными, 1–12 */
  lastMonth: number;
  series: IcpSeries[];
  warnings: string[];
}

export interface ToDecemberRow {
  kind: "to_december";
  key: string;
  name: string;
  year: number;
  month: number;
  value: number;
  note: string;
}

/** Код ОКВЭД2 из ячейки Росстата: «2» → «02», «8.11» → «08.11», «B» → «B»; собирательные группировки пропускаем */
export function normOkvedCode(v: unknown): string | null {
  const s = String(v ?? "").trim().toUpperCase();
  if (/^[A-U]$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})((?:\.\d{1,2}){0,3})$/);
  if (!m) return null;
  return m[1].padStart(2, "0") + m[2];
}

const num = (v: unknown) => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Файл Росстата «Индексы цен производителей по видам экономической деятельности» (много листов).
 * Берём лист «к декабрю предыдущего года» за нужный год, значения по Российской Федерации.
 */
export function parseRosstatIcp(buf: ArrayBuffer, baseYear: number): RosstatParse {
  // Сначала только названия листов, затем читаем лишь листы «N.2» — в файле Росстата их десятки и они большие
  const names = XLSX.read(buf, { type: "array", bookSheets: true }).SheetNames;
  const wanted = names.filter((n) => /\.2$/.test(n.trim()));
  const wb = XLSX.read(buf, { type: "array", sheets: wanted.length ? wanted : names });
  const warnings: string[] = [];
  const candidates: { sheet: string; year: number; grid: unknown[][] }[] = [];
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: null });
    const head = grid.slice(0, 4).flat().filter(Boolean).map(String).join(" ").replace(/\s+/g, " ");
    if (!/к декабрю предыдущего года/i.test(head) || !/цен\S*\s+производител/i.test(head)) continue;
    const y = head.match(/в\s+(20\d\d)\s*г/);
    if (y) candidates.push({ sheet: name, year: Number(y[1]), grid });
  }
  if (!candidates.length) throw new Error("В файле нет листа «Индексы цен производителей к декабрю предыдущего года». Нужен файл Росстата «Индексы цен производителей по видам экономической деятельности».");
  let pick = candidates.find((c) => c.year === baseYear);
  if (!pick) {
    pick = candidates.sort((a, b) => b.year - a.year)[0];
    warnings.push(`В файле нет данных за ${baseYear} год — взяты данные за ${pick.year} год.`);
  }
  const { grid } = pick;
  const headerRow = grid.findIndex((r) => r.some((c) => /^январь/i.test(String(c ?? "").trim())));
  if (headerRow < 0) throw new Error("Не найдена строка с месяцами");
  const monthCol: number[] = Array(12).fill(-1);
  grid[headerRow].forEach((c, i) => {
    const t = String(c ?? "").toLowerCase().replace(/\d\)|\s/g, "");
    const m = MONTHS.findIndex((x) => t.startsWith(x.slice(0, 3)));
    if (m >= 0) monthCol[m] = i;
  });
  const codeCol = grid[headerRow].findIndex((c) => /окв[эе]д/i.test(String(c ?? "")));
  const cc = codeCol >= 0 ? codeCol : 1;

  const series: IcpSeries[] = [];
  for (let i = headerRow + 1; i < grid.length; i++) {
    const r = grid[i];
    const key = normOkvedCode(r[cc]);
    if (!key) continue;
    const name = String(r[0] ?? "").replace(/\s+/g, " ").trim();
    let vals = monthCol.map((c) => (c >= 0 ? num(r[c]) : null));
    // Таблица по регионам: значения по стране — в строке «Российская Федерация» под видом деятельности
    if (vals.every((v) => v == null)) {
      const rf = grid.slice(i + 1, i + 4).find((x) => /^российская федерация/i.test(String(x[0] ?? "").trim()));
      if (!rf) continue;
      vals = monthCol.map((c) => (c >= 0 ? num(rf[c]) : null));
    }
    if (vals.some((v) => v != null) && !series.some((s) => s.key === key)) series.push({ key, name, values: vals });
  }
  const lastMonth = Math.max(0, ...series.map((s) => s.values.reduce<number>((m, v, idx) => (v != null ? idx + 1 : m), 0)));
  if (!series.length) throw new Error("На листе не найдено значений по видам деятельности");
  if (lastMonth < 12) warnings.push(`Данные есть до ${MONTHS_GEN[lastMonth - 1]} ${pick.year} года включительно — цены договоров будут пересчитаны до уровня ${MONTHS_GEN[lastMonth - 1]}, а не декабря. Загрузите файл заново, когда Росстат опубликует данные за декабрь.`);
  return { year: pick.year, sheet: pick.sheet, lastMonth, series, warnings };
}

/**
 * Коэффициент пересчёта цены договора месяца m до уровня последнего месяца (декабря):
 * накопленный индекс последнего месяца / накопленный индекс месяца договора.
 */
export function toDecemberRows(p: RosstatParse): ToDecemberRow[] {
  const out: ToDecemberRow[] = [];
  const upTo = p.lastMonth === 12 ? "декабря" : `${MONTHS_GEN[p.lastMonth - 1]} (последние данные)`;
  for (const s of p.series) {
    const last = s.values[p.lastMonth - 1];
    if (last == null) continue;
    for (let m = 1; m < p.lastMonth; m++) {
      const v = s.values[m - 1];
      if (v == null) continue;
      out.push({
        kind: "to_december", key: s.key, name: s.name, year: p.year, month: m,
        value: Math.round((last / v) * 100000) / 100000,
        note: `Росстат, ИЦП к декабрю ${p.year - 1} г.: ${MONTHS[m - 1]} ${v.toFixed(2)}, ${MONTHS[p.lastMonth - 1]} ${last.toFixed(2)}; пересчёт до ${upTo}`,
      });
    }
  }
  return out;
}
