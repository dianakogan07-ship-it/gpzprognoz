import * as XLSX from "xlsx";
import type { ForecastResult } from "./forecast";
import type { PriceIndex, Source } from "./types";
import { VAT_RATES } from "./seed";
import { normOkpd2, toNumber } from "./normalize";

const yesNo = (b: boolean | null) => (b == null ? "не определено" : b ? "да" : "нет");

export function forecastWorkbook(res: ForecastResult, sources: Source[], targetYear: number): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const main = res.rows.map((r) => ({
    "ОКПД2": r.okpd2,
    "Предмет (обезличенный)": r.subject,
    "Категория": r.category ?? "",
    "Код WS": r.ws ?? "",
    "Регион": r.regionName ?? r.region ?? "",
    "Ед. изм.": r.unit,
    "Договоров": r.contracts,
    "Мин. цена, ₽ без НДС": r.minPrice,
    "Макс. цена, ₽ без НДС": r.maxPrice,
    [`Цена ${targetYear - 1} (медиана, дек.), ₽ без НДС`]: r.basePrice,
    [`Индекс ${targetYear}`]: r.forecastIndex,
    "Источник индекса": r.indexSource,
    "Ссылка на источник": r.indexSourceUrl,
    [`Прогноз ${targetYear}, ₽ без НДС`]: r.forecastPrice,
    "Повторяющаяся": yesNo(r.repeatable),
    "Требует согласования": r.needsApproval ? "да" : "",
    "Отметки": r.flags.join(", "),
    "Комментарий": r.comment,
  }));
  const ws1 = XLSX.utils.json_to_sheet(main);
  ws1["!cols"] = [10, 50, 25, 10, 25, 10, 10, 14, 14, 18, 10, 40, 30, 18, 14, 12, 30, 80].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws1, "Прогноз");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(res.excluded.map((e) => ({ "Файл": e.file, "Строка": e.row, "Номер лота / ID": e.lot ?? "", "Причина": e.reason }))), "Не вошли");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sources.map((s) => ({ "Код": s.code, "Источник": s.name, "Ссылка": s.url, "Проверен": s.verified ? "да" : "нет", "Примечание": s.note ?? "" }))), "Источники");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    ...VAT_RATES.map((v) => ({ "Ставка НДС": v.rate, "Основание": v.basis })),
    { "Ставка НДС": "", "Основание": "Цены в прогнозе указаны без НДС. Ставка зависит от контрагента и предмета договора." },
  ]), "НДС (справочно)");
  return wb;
}

const INDEX_HEADERS = ["Вид (to_december / forecast / cpi)", "ОКПД2 или раздел ОКВЭД2", "Год", "Месяц заключения (для to_december)", "Коэффициент (1,12 = +12%)", "Код источника", "Утверждён (да/нет)", "Примечание"];

export function indexTemplate(indices: PriceIndex[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const rows = indices.map((i) => [i.kind, i.key ?? "", i.year, i.month ?? "", i.value, i.source_code ?? "", i.approved ? "да" : "нет", i.note ?? ""]);
  const ws = XLSX.utils.aoa_to_sheet([INDEX_HEADERS, ...rows]);
  ws["!cols"] = [22, 22, 8, 14, 14, 16, 12, 60].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, "Индексы");
  return wb;
}

export function parseIndexFile(buf: ArrayBuffer): { rows: Omit<PriceIndex, "id">[]; errors: string[] } {
  const wb = XLSX.read(buf, { type: "array" });
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  const rows: Omit<PriceIndex, "id">[] = [];
  const errors: string[] = [];
  grid.slice(1).forEach((r, i) => {
    if (!r || r.every((v) => v == null || v === "")) return;
    const line = i + 2;
    const kind = String(r[0] ?? "").trim() as PriceIndex["kind"];
    if (!["to_december", "forecast", "cpi"].includes(kind)) return void errors.push(`Строка ${line}: неизвестный вид «${r[0]}»`);
    const rawKey = String(r[1] ?? "").trim();
    const key = !rawKey ? null : /^[A-Za-z]$/.test(rawKey) ? rawKey.toUpperCase() : normOkpd2(rawKey);
    const year = toNumber(r[2]);
    const month = toNumber(r[3]);
    const value = toNumber(r[4]);
    if (!year) return void errors.push(`Строка ${line}: не указан год`);
    if (!value || value <= 0) return void errors.push(`Строка ${line}: неверный коэффициент`);
    if (kind === "to_december" && (!month || month < 1 || month > 12)) return void errors.push(`Строка ${line}: для to_december нужен месяц 1–12`);
    if (kind !== "cpi" && !key) return void errors.push(`Строка ${line}: не указан ОКПД2 / раздел ОКВЭД2`);
    rows.push({
      kind, key: kind === "cpi" ? null : key, year, month: kind === "to_december" ? month : null,
      value: value > 3 ? 1 + value / 100 : value, // «12» трактуется как +12%
      source_code: r[5] ? String(r[5]).trim() : null,
      approved: /^(да|yes|true|1)$/i.test(String(r[6] ?? "").trim()),
      note: r[7] ? String(r[7]) : null,
    });
  });
  return { rows, errors };
}

export function downloadWorkbook(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename);
}

/** Чтение простого справочника из Excel: первая строка — названия колонок таблицы */
export function parseSimpleSheet(buf: ArrayBuffer): Record<string, unknown>[] {
  const wb = XLSX.read(buf, { type: "array" });
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null });
}
