import * as XLSX from "xlsx";
import type { ForecastResult, ForecastRow } from "./forecast";
import { REASON_TEXT, STATUS_LABEL, reasonsOf, statusOf } from "./forecastView";
import type { PriceIndex, Source } from "./types";
import { VAT_RATES } from "./seed";
import { normOkpd2, toNumber } from "./normalize";
import { KIND_LABEL, MONTHS, coefToPercent } from "./indexFormat";

const yesNo = (b: boolean | null) => (b == null ? "не определено" : b ? "да" : "нет");

export function forecastWorkbook(res: ForecastResult, sources: Source[], targetYear: number, rows: ForecastRow[] = res.rows): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const main = rows.map((r) => ({
    "ОКПД2": r.okpd2,
    "Предмет (обезличенный)": r.subject,
    "Категория": r.category ?? "",
    "Код WS": r.ws ?? "",
    "Регион": r.regionName ?? r.region ?? "",
    "Ед. изм.": r.unitLabel,
    "Договоров": r.contracts,
    "Мин. цена, ₽ без НДС": r.minPrice,
    "Макс. цена, ₽ без НДС": r.maxPrice,
    [`Цена ${targetYear - 1} (медиана, дек.), ₽ без НДС`]: r.basePrice,
    [`Рост ${targetYear}, %`]: Math.round((r.forecastIndex - 1) * 1000) / 10,
    "Источник индекса": r.indexSource,
    "Ссылка на источник": r.indexSourceUrl,
    [`Прогноз ${targetYear}, ₽ без НДС`]: r.forecastPrice,
    "Ставка НДС, %": Math.round((r.vatRate ?? 0.22) * 100),
    [`Прогноз ${targetYear}, ₽ с НДС`]: Math.round(r.forecastPrice * (1 + (r.vatRate ?? 0.22)) * 100) / 100,
    "Повторяющаяся": yesNo(r.repeatable),
    "Статус": STATUS_LABEL[statusOf(r)],
    "Причины": reasonsOf(r).map((x) => REASON_TEXT[x]).join("; "),
    "Комментарий": r.comment,
  }));
  const ws1 = XLSX.utils.json_to_sheet(main);
  ws1["!cols"] = [10, 50, 25, 10, 25, 10, 10, 14, 14, 18, 10, 40, 30, 18, 14, 12, 30, 80].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws1, "Прогноз");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(res.excluded.map((e) => ({ "Файл": e.file, "Строка": e.row, "Номер лота / ID": e.lot ?? "", "Причина": e.reason }))), "Не вошли");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sources.map((s) => ({ "Код": s.code, "Источник": s.name, "Ссылка": s.url, "Проверен": s.verified ? "да" : "нет", "Примечание": s.note ?? "" }))), "Источники");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    ...VAT_RATES.map((v) => ({ "Ставка НДС": v.rate, "Основание": v.basis })),
    { "Ставка НДС": "", "Основание": "Прогноз с НДС посчитан по ставке из ГПЗ; если ставки в файле нет — по основной ставке 22 %." },
  ]), "НДС (справочно)");
  return wb;
}

const INDEX_HEADERS = ["Тип индекса", "Код ОКПД2/ОКВЭД2", "Год", "Месяц", "Рост, %", "Источник", "Утверждено (Да/Нет)", "Примечание"];
const KIND_BY_LABEL: Record<string, PriceIndex["kind"]> = Object.fromEntries(
  (Object.entries(KIND_LABEL) as [PriceIndex["kind"], string][]).flatMap(([k, l]) => [[l.toLowerCase(), k], [k, k]]),
);

/** Выгрузка индексов (или пустой шаблон) в формате для закупщика */
export function indexTemplate(indices: PriceIndex[], sources: Source[] = []): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const srcName = (code: string | null) => (code ? sources.find((s) => s.code === code)?.name ?? code : "");
  const rows = indices.map((i) => [
    KIND_LABEL[i.kind], i.key ?? "", i.year, i.month ? MONTHS[i.month - 1] : "", coefToPercent(i.value),
    srcName(i.source_code), i.approved ? "Да" : "Нет", i.note ?? "",
  ]);
  const ws = XLSX.utils.aoa_to_sheet([INDEX_HEADERS, ...rows]);
  ws["!cols"] = [22, 18, 8, 12, 10, 50, 18, 60].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, "Индексы");
  const help = XLSX.utils.aoa_to_sheet([
    ["Колонка", "Как заполнять"],
    ["Тип индекса", "Рост по отрасли / Общая инфляция / Пересчёт до декабря"],
    ["Код ОКПД2/ОКВЭД2", "Код ОКПД2 (например, 43 или 43.2) или буква раздела ОКВЭД2 (например, F). Для общей инфляции не заполняется"],
    ["Год", "Для роста по отрасли и инфляции — год прогноза; для пересчёта — год заключения договоров"],
    ["Месяц", "Только для пересчёта до декабря: месяц заключения договора (название или число 1–12)"],
    ["Рост, %", "Например, 12 — рост на 12 %; −2 — снижение на 2 %"],
    ["Источник", "Название или код источника из справочника источников"],
    ["Утверждено (Да/Нет)", "Нет — индекс помечается «Нужна проверка»"],
  ]);
  help["!cols"] = [{ wch: 22 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(wb, help, "Как заполнять");
  return wb;
}

export interface IndexParseError { line: number; message: string }

function parseMonth(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = toNumber(v);
  if (n != null) return n;
  const s = String(v).trim().toLowerCase();
  const i = MONTHS.findIndex((m) => s.startsWith(m.slice(0, 3)));
  return i >= 0 ? i + 1 : NaN;
}

/**
 * Чтение файла индексов. Понимает новый формат (русские колонки, рост в %)
 * и старый (kind / key / коэффициент, коды источников) — по заголовку первой колонки.
 */
export function parseIndexFile(buf: ArrayBuffer, sources: Source[] = []): { rows: Omit<PriceIndex, "id">[]; errors: IndexParseError[] } {
  const wb = XLSX.read(buf, { type: "array" });
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  const header = String(grid[0]?.[0] ?? "").toLowerCase();
  const legacy = /^вид|^kind/.test(header);
  const valueHeader = String(grid[0]?.[4] ?? "").toLowerCase();
  const valueIsPercent = !legacy || /%|рост/.test(valueHeader) && !/коэфф/.test(valueHeader);
  const rows: Omit<PriceIndex, "id">[] = [];
  const errors: IndexParseError[] = [];
  const findSource = (v: unknown) => {
    const s = String(v ?? "").trim();
    if (!s) return null;
    const hit = sources.find((x) => x.code.toLowerCase() === s.toLowerCase() || x.name.toLowerCase() === s.toLowerCase());
    return hit ? hit.code : sources.length ? undefined : s;
  };
  grid.slice(1).forEach((r, i) => {
    if (!r || r.every((v) => v == null || v === "")) return;
    const line = i + 2;
    const err = (message: string) => void errors.push({ line, message });
    const kind = KIND_BY_LABEL[String(r[0] ?? "").trim().toLowerCase()];
    if (!kind) return err(`неизвестный тип индекса «${r[0] ?? ""}»`);
    const rawKey = String(r[1] ?? "").trim();
    const key = !rawKey ? null : /^[A-Za-z]$/.test(rawKey) ? rawKey.toUpperCase() : normOkpd2(rawKey);
    const year = toNumber(r[2]);
    const month = parseMonth(r[3]);
    const raw = toNumber(String(r[4] ?? "").replace("−", "-").replace("%", ""));
    if (!year) return err("не указан год");
    if (raw == null) return err("не указан рост, %");
    const value = valueIsPercent ? 1 + raw / 100 : raw > 3 ? 1 + raw / 100 : raw;
    if (value <= 0) return err("рост не может быть меньше −100 %");
    if (kind === "to_december" && (!month || month < 1 || month > 12)) return err("для пересчёта до декабря нужен месяц");
    if (kind !== "cpi" && !key) return err("не указан код ОКПД2/ОКВЭД2");
    if (rawKey && kind !== "cpi" && !key) return err(`неверный код «${rawKey}»`);
    const source_code = findSource(r[5]);
    if (source_code === undefined) return err(`источник «${r[5]}» не найден в справочнике источников`);
    rows.push({
      kind, key: kind === "cpi" ? null : key, year, month: kind === "to_december" ? month : null,
      value: Math.round(value * 100000) / 100000,
      source_code,
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
