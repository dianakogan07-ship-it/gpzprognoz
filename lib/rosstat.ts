import * as XLSX from "xlsx";
import { MONTHS } from "./indexFormat";

export const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** Индексы цен производителей одного вида деятельности: накопленный рост к декабрю прошлого года по месяцам */
export interface IcpSeries { key: string; name: string; values: (number | null)[] }

export interface RosstatParse {
  year: number;
  sheet: string;
  kind: RosstatKind;
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

/** Число из ячейки Росстата: «104.97», «104,17 2)», «108,832)» (сноска приклеена к числу) */
const num = (v: unknown) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v > 0 ? v : null;
  const m = String(v).replace(/\s/g, "").match(/^(\d+)(?:[.,](\d{1,2}))?/);
  if (!m) return null;
  const n = Number(`${m[1]}.${m[2] ?? "0"}`);
  return n > 0 ? n : null;
};

export type RosstatKind = "industry" | "construction" | "freight" | "telecom";
export const ROSSTAT_KIND_TITLE: Record<RosstatKind, string> = {
  industry: "Промышленные товары",
  construction: "Строительная продукция",
  freight: "Грузовые перевозки",
  telecom: "Услуги связи для юридических лиц",
};

const detectKind = (text: string): RosstatKind =>
  /строительн\S*\s+продукц/i.test(text) ? "construction" : /грузов/i.test(text) ? "freight" : /услуги\s+связи/i.test(text) ? "telecom" : "industry";

/** Виды грузового транспорта → коды ОКВЭД2 */
const FREIGHT: [RegExp, string][] = [
  [/^железнодорожн/i, "49.2"],
  [/^автомобильн/i, "49.4"],
  [/^трубопроводн/i, "49.5"],
  [/^морск/i, "50.2"],
  [/^внутренн\S*\s+водн/i, "50.4"],
  [/^воздушн/i, "51.21"],
  [/без\s+трубопроводного/i, "H"],
];

const CUMULATIVE = /к\s+декабрю\s+предыдущего\s+года|к\s+концу\s+IV\s+квартала\s+предыдущего\s+года/i;

/** Номера листов с накопленными индексами по годам — из листа «Содержание» */
function contents(wb: XLSX.WorkBook): { sheet: string; year: number }[] {
  const first = wb.Sheets[wb.SheetNames[0]];
  if (!first) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(first, { header: 1, defval: null }).map((r) => r.filter(Boolean).map(String).join(" ").replace(/\s+/g, " ").trim());
  const out: { sheet: string; year: number }[] = [];
  let year = 0;
  for (const t of rows) {
    const y = t.match(/в\s+(20\d\d)\s*г/);
    if (y && !/\d{4}\s*[-–]\s*\d{4}/.test(t)) year = Number(y[1]);
    const n = t.match(/^(\d+(?:\.\d+)?)\.?\s/);
    if (n && year && CUMULATIVE.test(t)) out.push({ sheet: n[1], year });
  }
  return out.filter((x) => wb.SheetNames.includes(x.sheet) || wb.SheetNames.includes(`${x.sheet}.`));
}

/**
 * Файлы Росстата раздела «Цены производителей»: промышленные товары (по видам деятельности),
 * строительная продукция, грузовые перевозки, услуги связи. Берём лист с накопленным
 * индексом «к декабрю (к IV кварталу) предыдущего года» за нужный год, значения по России.
 */
export function parseRosstatIcp(buf: ArrayBuffer, baseYear: number): RosstatParse {
  // Сначала читаем только «Содержание» — листов в файлах Росстата десятки, и они большие
  const names = XLSX.read(buf, { type: "array", bookSheets: true }).SheetNames;
  const head = XLSX.read(buf, { type: "array", sheets: [names[0]] });
  head.SheetNames = names;
  const listed = contents(head);
  const warnings: string[] = [];
  let pickedName: string | null = null, pickedYear = 0;
  if (listed.length) {
    const exact = listed.find((x) => x.year === baseYear);
    const latest = [...listed].sort((a, b) => b.year - a.year)[0];
    const c = exact ?? latest;
    pickedName = names.includes(c.sheet) ? c.sheet : `${c.sheet}.`;
    pickedYear = c.year;
    if (!exact) warnings.push(`В файле нет данных за ${baseYear} год — взяты данные за ${c.year} год.`);
  }
  const wb = XLSX.read(buf, { type: "array", sheets: pickedName ? [pickedName] : names.filter((n) => /\.2$/.test(n.trim())).concat(names.length < 40 ? names : []) });
  const candidates: { sheet: string; year: number; grid: unknown[][]; text: string }[] = [];
  for (const name of pickedName ? [pickedName] : wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: null });
    const text = grid.slice(0, 4).flat().filter(Boolean).map(String).join(" ").replace(/\s+/g, " ");
    if (!CUMULATIVE.test(text)) continue;
    const y = text.match(/в\s+(20\d\d)\s*г/);
    candidates.push({ sheet: name, year: y ? Number(y[1]) : pickedYear, grid, text });
  }
  if (!candidates.length) throw new Error("В файле нет листа с индексами «к декабрю предыдущего года». Подходят файлы Росстата из раздела «Цены производителей»: промышленные товары, строительная продукция, грузовые перевозки, услуги связи.");
  let pick = candidates.find((c) => c.year === baseYear);
  if (!pick) {
    pick = candidates.sort((a, b) => b.year - a.year)[0];
    if (!warnings.length) warnings.push(`В файле нет данных за ${baseYear} год — взяты данные за ${pick.year} год.`);
  }
  if (/инвестиционного\s+назначения/i.test(pick.text)) {
    throw new Error("Это индекс цен на продукцию инвестиционного назначения: он показывает, как дорожают вложения самой отрасли, а не цены её товаров. Для пересчёта цен договоров он не подходит.");
  }
  const kind = detectKind(pick.text);
  const { grid } = pick;
  const headerRow = grid.findIndex((r) => r.some((c) => /^(январь|i\s+квартал)/i.test(String(c ?? "").trim())));
  if (headerRow < 0) throw new Error("Не найдена строка с месяцами");

  // Колонка каждого месяца; для квартальных данных — значение конца квартала на все его месяцы
  const monthCol: number[] = Array(12).fill(-1);
  grid[headerRow].forEach((c, i) => {
    const t = String(c ?? "").toLowerCase().replace(/\d\)|\s/g, "");
    const m = MONTHS.findIndex((x) => t.startsWith(x.slice(0, 3)));
    if (m >= 0) monthCol[m] = i;
    const q = ["i", "ii", "iii", "iv"].indexOf(t.replace(/квартал.*/, ""));
    if (q >= 0) for (let k = 0; k < 3; k++) monthCol[q * 3 + k] = i;
  });
  const valuesOf = (r: unknown[]) => monthCol.map((c) => (c >= 0 ? num(r[c]) : null));
  const label = (r: unknown[]) => String(r[0] ?? "").replace(/\s+/g, " ").trim();
  const series: IcpSeries[] = [];
  const add = (key: string, name: string, values: (number | null)[]) => {
    if (values.some((v) => v != null) && !series.some((s) => s.key === key)) series.push({ key, name, values });
  };
  const rows = grid.slice(headerRow + 1);

  if (kind === "construction") {
    // Строки здесь — отрасли-заказчики; для закупок строительных работ берём итог по всем
    const total = rows.find((r) => /^всего/i.test(label(r)));
    if (total) add("F", "Строительная продукция (всего)", valuesOf(total));
  } else if (kind === "freight") {
    for (const r of rows) {
      const hit = FREIGHT.find(([re]) => re.test(label(r)));
      if (hit) add(hit[1], `Грузовые перевозки: ${label(r).toLowerCase()}`, valuesOf(r));
    }
  } else if (kind === "telecom") {
    const total = rows.find((r) => /^услуги\s+связи\s+для\s+юридических/i.test(label(r)));
    if (total) add("61", "Услуги связи для юридических лиц", valuesOf(total));
  } else {
    const codeCol = grid[headerRow].findIndex((c) => /окв[эе]д/i.test(String(c ?? "")));
    const cc = codeCol >= 0 ? codeCol : 1;
    rows.forEach((r, i) => {
      const key = normOkvedCode(r[cc]);
      if (!key) return;
      let vals = valuesOf(r);
      // Таблица по регионам: значения по стране — в строке «Российская Федерация» под видом деятельности
      if (vals.every((v) => v == null)) {
        const rf = rows.slice(i + 1, i + 4).find((x) => /^российская федерация/i.test(label(x)));
        if (!rf) return;
        vals = valuesOf(rf);
      }
      add(key, label(r), vals);
    });
  }
  if (!series.length) throw new Error(`На листе ${pick.sheet} не найдено значений`);
  const lastMonth = Math.max(0, ...series.map((s) => s.values.reduce<number>((m, v, idx) => (v != null ? idx + 1 : m), 0)));
  if (lastMonth < 12) warnings.push(`${ROSSTAT_KIND_TITLE[kind]}: данные есть до ${MONTHS_GEN[lastMonth - 1]} ${pick.year} года включительно — цены договоров будут пересчитаны до уровня ${MONTHS_GEN[lastMonth - 1]}, а не декабря. Загрузите файл заново, когда Росстат опубликует данные за декабрь.`);
  return { year: pick.year, sheet: pick.sheet, kind, lastMonth, series, warnings };
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
        note: `Росстат, ${ROSSTAT_KIND_TITLE[p.kind].toLowerCase()}, к декабрю ${p.year - 1} г.: ${MONTHS[m - 1]} ${v.toFixed(2)}, ${MONTHS[p.lastMonth - 1]} ${last.toFixed(2)}; пересчёт до ${upTo}`,
      });
    }
  }
  return out;
}
