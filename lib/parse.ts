import * as XLSX from "xlsx";
import { normKey, normOkpd2, normRegion, normUnit, normWs, parseVatRate, toDate, toNumber } from "./normalize";

export interface GpzRow {
  row: number;
  lot: string | null;
  procId: string | null;
  subject: string | null;
  okpd2: string | null;
  unit: string | null;
  /** Наименование единицы, если в ГПЗ есть отдельная колонка (приоритетнее кода) */
  unitName: string | null;
  /** Способ закупки */
  method: string | null;
  quantity: number | null;
  region: string | null;
  category: string | null;
  ws: string | null;
  /** Ставка НДС, доля: 0.22 */
  vatRate: number | null;
}
export interface ReportRow {
  row: number;
  lot: string | null;
  procId: string | null;
  status: string | null;
  priceNoVat: number | null;
  quantity: number | null;
  contractDate: Date | null;
  ws: string | null;
  vatRate: number | null;
}

type Matcher = RegExp[];
const GPZ_COLS: Record<keyof Omit<GpzRow, "row">, Matcher> = {
  lot: [/реестров\S*\s+номер\s+лот/i, /номер\s+лота/i],
  procId: [/id\s*процедур/i, /идентификатор\s+процедур/i],
  subject: [/предмет/i, /наименовани\S*\s+(закупк|лот|договор)/i],
  okpd2: [/окпд/i],
  unit: [/ед\S*\s*изм/i, /океи/i],
  unitName: [/единиц\S*\s+измерени\S*\s*\/\s*наименовани/i, /наименовани\S*\s+(единиц|ед\.|океи)/i],
  quantity: [/количеств/i, /объ[её]м/i],
  region: [/окато/i, /регион/i],
  category: [/категори/i],
  method: [/способ\S*\s+закупк/i, /^способ/i],
  ws: [/\bws\b/i, /код\s*ws/i, /код\s+услуг/i, /услуг\S* \/ код$/i],
  vatRate: [/ставк\S*\s*ндс/i, /^ндс,?\s*%?$/i],
};
const REPORT_COLS: Record<string, Matcher> = {
  lot: GPZ_COLS.lot,
  procId: GPZ_COLS.procId,
  status: [/статус/i, /состояни/i],
  // Сначала фактическая стоимость договора, затем предложение победителя, затем любая «цена без НДС» (кроме НМЦ)
  priceNoVat: [
    /(цен|сумм|стоимост)\S*\s+договор\S*(\s+документ\S*)?.*без\s*ндс/i,
    /(стоимост|цен)\S*\s+предложени\S*.*без\s*ндс/i,
    /цен\S*.*без\s*ндс/i, /сумм\S*.*без\s*ндс/i, /стоимост\S*.*без\s*ндс/i,
  ],
  priceWithVat: [
    /(цен|сумм|стоимост)\S*\s+договор/i,
    /(стоимост|цен)\S*\s+предложени\S*.*с\s*ндс/i,
  ],
  vatRate: [/ставк\S*\s*ндс/i, /^ндс$/i, /ндс,?\s*%/i],
  quantity: GPZ_COLS.quantity,
  contractDate: [/дат\S*\s+(заключ|подпис)/i, /дат\S*\s+договор/i],
  ws: GPZ_COLS.ws,
};

const PRICE_EXCLUDE = [/начальн/i, /максимальн/i, /\bнмц/i, /валют/i, /эконом/i, /эффективн/i];
const EXCLUDE: Record<string, RegExp[]> = {
  priceNoVat: PRICE_EXCLUDE,
  priceWithVat: [...PRICE_EXCLUDE, /без\s*ндс/i],
  subject: [/окпд/i],
  quantity: [/заяв/i, /участник/i, /предложени/i],
  status: [/договорн/i],
};

const isNumberingRow = (row: unknown[], width: number) =>
  row.filter((v) => v != null && v !== "").length > 3 &&
  row.every((v, i) => v == null || v === "" || Number(v) === i + 1 || (Number.isFinite(Number(v)) && Number(v) <= width + 10));

/** Строка данных: есть даты или крупные числа (суммы, ID) — в шапке такого не бывает */
const isDataRow = (row: unknown[]) =>
  row.filter((v) => v instanceof Date || (typeof v === "number" && Math.abs(v) > 1000)).length >= 2;

/** Читает лист с многоуровневой шапкой: объединяет уровни через « / » с учётом объединённых ячеек */
export function readSheet(buf: ArrayBuffer): { headers: string[]; rows: unknown[][]; firstDataRow: number } {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
  for (const m of ws["!merges"] ?? []) {
    const v = grid[m.s.r]?.[m.s.c];
    for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) {
      grid[r] ??= [];
      if (r < 15) grid[r][c] = v;
    }
  }
  // Шапка: строки до первой строки, похожей на данные (в шапке почти нет чисел)
  const all = [...Object.values(GPZ_COLS), ...Object.values(REPORT_COLS)].flat();
  // Шапка заканчивается перед строкой нумерации колонок или первой строкой с данными
  let lastHeader = -1;
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const row = grid[r] ?? [];
    if (lastHeader >= 0 && (isNumberingRow(row, row.length) || isDataRow(row))) break;
    const hits = row.filter((c) => typeof c === "string" && all.some((re) => re.test(c))).length;
    if (hits >= (lastHeader < 0 ? 2 : 1)) lastHeader = r;
  }
  if (lastHeader < 0) throw new Error("Не найдена шапка таблицы (нет колонок ОКПД2, ID процедуры, номера лота и т. п.)");
  let firstHeader = lastHeader;
  while (firstHeader > 0 && (grid[firstHeader - 1] ?? []).some((c) => typeof c === "string" && c.trim())) firstHeader--;
  const width = Math.max(...grid.slice(firstHeader, lastHeader + 1).map((r) => r?.length ?? 0));
  const headers = Array.from({ length: width }, (_, c) => {
    const parts: string[] = [];
    for (let r = firstHeader; r <= lastHeader; r++) {
      const v = grid[r]?.[c];
      const s = v == null ? "" : String(v).replace(/\s+/g, " ").trim();
      if (s && parts[parts.length - 1] !== s) parts.push(s);
    }
    return parts.join(" / ");
  });
  let first = lastHeader + 1;
  // Пропуск строки с нумерацией колонок «1, 2, 3 …»
  if (isNumberingRow(grid[first] ?? [], width)) first++;
  return { headers, rows: grid.slice(first), firstDataRow: first + 1 };
}

/** Индекс колонки: сначала по последнему уровню шапки, затем по полному названию */
function findCol(headers: string[], matchers: Matcher, exclude: RegExp[] = []): number {
  const leaf = headers.map((h) => h.split(" / ").pop() ?? "");
  for (const src of [leaf, headers]) for (const re of matchers) {
    const i = src.findIndex((h) => re.test(h) && !exclude.some((x) => x.test(h)));
    if (i >= 0) return i;
  }
  return -1;
}

export function mapColumns(headers: string[], kind: "gpz" | "report") {
  const spec = kind === "gpz" ? GPZ_COLS : REPORT_COLS;
  const out: Record<string, number> = {};
  for (const [k, m] of Object.entries(spec)) {
    out[k] = findCol(headers, m, EXCLUDE[k] ?? []);
  }
  return out;
}

const cell = (r: unknown[], i: number) => (i >= 0 ? r[i] ?? null : null);
const str = (v: unknown) => (v == null ? null : String(v).trim() || null);

export function parseGpz(buf: ArrayBuffer, regionCodes: string[]) {
  const { headers, rows, firstDataRow } = readSheet(buf);
  const c = mapColumns(headers, "gpz");
  const missing = (["okpd2", "quantity"] as const).filter((k) => c[k] < 0);
  if (c.lot < 0 && c.procId < 0) missing.push("lot/procId" as never);
  if (missing.length) throw new Error(`ГПЗ: не найдены колонки ${missing.join(", ")}`);
  const out: GpzRow[] = [];
  rows.forEach((r, i) => {
    if (!r || r.every((v) => v == null || v === "")) return;
    out.push({
      row: firstDataRow + i,
      lot: normKey(cell(r, c.lot)),
      procId: normKey(cell(r, c.procId)),
      subject: str(cell(r, c.subject)),
      okpd2: normOkpd2(cell(r, c.okpd2)),
      unit: normUnit(cell(r, c.unit)),
      unitName: normUnit(cell(r, c.unitName)),
      method: str(cell(r, c.method)),
      quantity: toNumber(cell(r, c.quantity)),
      region: normRegion(cell(r, c.region), regionCodes),
      category: str(cell(r, c.category)),
      ws: normWs(cell(r, c.ws)),
      vatRate: parseVatRate(cell(r, c.vatRate)),
    });
  });
  return { rows: out, headers, columns: c };
}

export function parseReport(buf: ArrayBuffer) {
  const { headers, rows, firstDataRow } = readSheet(buf);
  const c = mapColumns(headers, "report");
  const missing: string[] = [];
  if (c.lot < 0 && c.procId < 0) missing.push("lot/procId");
  if (c.priceNoVat < 0 && c.priceWithVat < 0) missing.push("цена договора");
  if (missing.length) throw new Error(`Отчётность: не найдены колонки ${missing.join(", ")}`);
  const out: ReportRow[] = [];
  rows.forEach((r, i) => {
    if (!r || r.every((v) => v == null || v === "")) return;
    let price = toNumber(cell(r, c.priceNoVat));
    if (price == null && c.priceWithVat >= 0) {
      const withVat = toNumber(cell(r, c.priceWithVat));
      const rate = parseVatRate(cell(r, c.vatRate));
      if (withVat != null && rate != null) price = withVat / (1 + rate);
    }
    out.push({
      row: firstDataRow + i,
      lot: normKey(cell(r, c.lot)),
      procId: normKey(cell(r, c.procId)),
      status: str(cell(r, c.status)),
      priceNoVat: price,
      quantity: toNumber(cell(r, c.quantity)),
      contractDate: toDate(cell(r, c.contractDate)),
      ws: normWs(cell(r, c.ws)),
      vatRate: parseVatRate(cell(r, c.vatRate)),
    });
  });
  return { rows: out, headers, columns: c };
}
