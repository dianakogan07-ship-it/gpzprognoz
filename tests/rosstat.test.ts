import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { normOkvedCode, parseRosstatIcp, toDecemberRows } from "@/lib/rosstat";

const book = (sheets: [string, unknown[][]][]) => {
  const wb = XLSX.utils.book_new();
  for (const [n, aoa] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), n);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
};
const M = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

describe("файл Росстата: индексы цен производителей", () => {
  const old = ["Индексы цен производителей по видам экономической деятельности по Российской Федеpации в 2025 г.", null];
  const buf = book([
    ["Содержание", [["Индексы цен производителей"]]],
    ["7.1", [["Индексы цен производителей по видам экономической деятельности в 2025 г."], ["к предыдущему месяцу"], [null, "ОКВЭД 2", ...M]]],
    ["7.2", [old, [null, null, "на конец периода, в % к декабрю предыдущего года"], [null, "ОКВЭД2", ...M],
      ["Лесозаготовки", "2.2", 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112.2],
      ["ОБРАБАТЫВАЮЩИЕ ПРОИЗВОДСТВА", "C", 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 110],
      ["Собирательная группировка", "1323500.029.31", 101, 101, 101, 101, 101, 101, 101, 101, 101, 101, 101, 101]]],
    ["8.2", [["Индексы цен производителей по видам экономической деятельности по Российской Федерации, федеральным округам и субъектам в 2026 г.1)"],
      [null, null, "на конец периода, в % к декабрю предыдущего года"], [null, "ОКВЭД 2", ...M.slice(0, 8)],
      ["Лесоводство и лесозаготовки", "02"], ["Российская Федерация", null, 100, 101, 102, 103, 104, 105, 106, 107],
      ["Центральный федеральный округ", null, 90, 90, 90, 90, 90, 90, 90, 90],
      ["Добыча угля", "05"], ["Российская Федерация", null, 110, 110, 110, 110, 110, 110, 110, 121]]],
  ]);

  it("коды ОКВЭД2 приводятся к виду ОКПД2", () => {
    expect(normOkvedCode("2")).toBe("02");
    expect(normOkvedCode("8.11")).toBe("08.11");
    expect(normOkvedCode("06.10.1")).toBe("06.10.1");
    expect(normOkvedCode("B")).toBe("B");
    expect(normOkvedCode("1323500.029.31")).toBeNull();
    expect(normOkvedCode("ОКВЭД2")).toBeNull();
  });

  it("год с регионами: берутся строки «Российская Федерация», данные до августа", () => {
    const p = parseRosstatIcp(buf, 2026);
    expect(p).toMatchObject({ year: 2026, sheet: "8.2", lastMonth: 8 });
    expect(p.series.map((s) => s.key)).toEqual(["02", "05"]);
    expect(p.warnings[0]).toContain("до августа 2026 года включительно");
    const rows = toDecemberRows(p);
    expect(rows).toHaveLength(14);
    expect(rows.find((r) => r.key === "05" && r.month === 1)).toMatchObject({ value: 1.1, year: 2026 });
    expect(rows.find((r) => r.key === "02" && r.month === 7)?.value).toBe(1.00943);
  });

  it("полный год без регионов: пересчёт до декабря, собирательные группировки пропускаются", () => {
    const p = parseRosstatIcp(buf, 2025);
    expect(p).toMatchObject({ year: 2025, sheet: "7.2", lastMonth: 12, warnings: [] });
    expect(p.series.map((s) => s.key)).toEqual(["02.2", "C"]);
    const rows = toDecemberRows(p);
    expect(rows.find((r) => r.key === "C" && r.month === 3)).toMatchObject({ value: 1.1 });
    expect(rows.find((r) => r.key === "02.2" && r.month === 1)?.value).toBe(1.11089);
    expect(rows.every((r) => r.month < 12)).toBe(true);
  });

  it("нет нужного года — берётся последний с предупреждением", () => {
    const p = parseRosstatIcp(buf, 2027);
    expect(p.year).toBe(2026);
    expect(p.warnings[0]).toContain("нет данных за 2027 год");
  });

  it("другой файл — понятная ошибка", () => {
    expect(() => parseRosstatIcp(book([["1", [["Что-то другое"]]]]), 2026)).toThrow("Индексы цен производителей к декабрю предыдущего года");
  });
});
