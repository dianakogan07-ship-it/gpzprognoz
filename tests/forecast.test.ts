import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseGpz, parseReport } from "@/lib/parse";
import { buildForecast, robustMedian, anonymize } from "@/lib/forecast";
import { parseIndexFile, indexTemplate } from "@/lib/excel";
import { SEED } from "@/lib/seed";
import type { Reference } from "@/lib/types";

const toBuf = (aoa: unknown[][], merges: XLSX.Range[] = []) => {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = merges;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Лист1");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
};

// ГПЗ с трёхуровневой шапкой и строкой нумерации колонок
const gpzBuf = toBuf([
  ["Сведения о закупке", null, null, null, null, null, null, null],
  ["Идентификация", null, "Предмет", null, null, "Количество", "Место", null],
  ["ID процедуры", "Реестровый номер лота", "Предмет договора", "Код ОКПД2", "Ед. изм.", "Количество (объем)", "ОКАТО", "Код WS"],
  [1, 2, 3, 4, 5, 6, 7, 8],
  ["P1", "L-1", "Аренда офиса ООО «Ромашка»", "68.20.12.000", "мес", 12, "40000000000", "WS90107"],
  ["P2", "L-2", "Аренда офиса", "68.20.12", "мес", 12, "40263000000", "WS90107"],
  ["P3", "L-3", "Поставка станка", "28.41.1", "шт", 1, "45000000000", null],
  ["P4", "L-4", "Аренда офиса", "68.20.12", "мес", 12, "40000000000", "WS90107"],
  ["P5", "L-5", "Охрана", "80.10.12", "мес", 12, "40000000000", "WS99999"],
], [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } }]);

const repBuf = toBuf([
  ["Реестровый номер лота", "Статус закупки", "Цена договора без НДС, руб.", "Дата заключения договора", "Код WS"],
  ["L-1", "Договор заключён", 54_000_000, "15.02.2026", "WS90107"],
  ["L-2", "Договор заключён", 54_000_000, "15.12.2026", "WS90107"],
  ["L-3", "Не размещена", null, null, null],
  ["L-4", "Договор заключён", "540 000 000,00", "15.12.2026", "WS90107"],
  ["L-5", "Договор заключён", 1_200_000, "10.12.2026", "WS99999"],
  ["L-9", "Договор заключён", 100, "10.12.2026", null],
]);

const ref: Reference = {
  ...SEED,
  indices: [
    ...SEED.indices,
    { id: 10, kind: "to_december", key: "68", year: 2026, month: 2, value: 1.05, source_code: "ROSSTAT_ICP", approved: true, note: null },
    { id: 11, kind: "forecast", key: "L", year: 2027, month: null, value: 1.06, source_code: "MER_FORECAST", approved: true, note: null },
  ],
};

describe("разбор выгрузок", () => {
  it("находит колонки в многоуровневой шапке и нормализует коды", () => {
    const g = parseGpz(gpzBuf, SEED.regions.map((r) => r.code));
    expect(g.rows).toHaveLength(5);
    expect(g.rows[0]).toMatchObject({ lot: "L-1", okpd2: "68.20.12.000", unit: "мес", quantity: 12, region: "40", ws: "WS90107" });
    const r = parseReport(repBuf);
    expect(r.rows[3].priceNoVat).toBe(540_000_000);
    expect(r.rows[0].contractDate?.getUTCMonth()).toBe(1);
  });
});

describe("расчёт прогноза", () => {
  const g = parseGpz(gpzBuf, SEED.regions.map((r) => r.code)).rows;
  const r = parseReport(repBuf).rows;
  const res = buildForecast(g, r, ref, { baseYear: 2026, targetYear: 2027 });

  it("группирует, исключает выбросы, доводит до декабря и индексирует", () => {
    // «68.20.12.000» и «68.20.12» — разные коды, разные группы
    expect(res.rows.filter((x) => x.okpd2.startsWith("68.20.12"))).toHaveLength(2);
    const all = res.rows.find((x) => x.okpd2 === "68.20.12")!;
    expect(all.contracts).toBe(2);
    expect(all.indexLevel).toBe("okved2");
    expect(all.forecastIndex).toBe(1.06);
    const feb = res.rows.find((x) => x.okpd2 === "68.20.12.000")!;
    expect(feb.basePrice).toBe(4_725_000); // 4,5 млн × 1,05
    expect(feb.forecastPrice).toBe(5_008_500);
    expect(feb.flags).toContain("малая выборка");
    expect(feb.needsApproval).toBe(false);
  });

  it("без отраслевого индекса применяет ИПЦ и требует согласования", () => {
    const guard = res.rows.find((x) => x.okpd2.startsWith("80"))!;
    expect(guard.indexLevel).toBe("cpi");
    expect(guard.forecastIndex).toBe(1.04);
    expect(guard.needsApproval).toBe(true);
    expect(guard.repeatable).toBe(true);
  });

  it("собирает исключённые строки и новые коды WS", () => {
    expect(res.excluded.map((e) => e.reason)).toEqual(expect.arrayContaining([expect.stringContaining("Не размещена"), "Нет в ГПЗ"]));
    expect(res.newWsCodes).toEqual(["WS99999"]);
    expect(res.rows.every((x) => !x.subject.includes("Ромашка"))).toBe(true);
  });
});

describe("вспомогательное", () => {
  it("медиана без выбросов", () => {
    const m = robustMedian([100, 110, 120, 1000]);
    expect(m.outliers).toBe(1);
    expect(m.value).toBe(110);
  });
  it("обезличивание", () => expect(anonymize("Аренда ООО «Ромашка» ИНН 7700000000")).toBe("Аренда"));
  it("шаблон индексов читается обратно", () => {
    const buf = XLSX.write(indexTemplate(ref.indices), { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const { rows, errors } = parseIndexFile(buf);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows.find((x) => x.kind === "to_december")).toMatchObject({ key: "68", month: 2, value: 1.05, approved: true });
  });
});
