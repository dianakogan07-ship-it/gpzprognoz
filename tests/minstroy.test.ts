import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { minstroyByRegion, parseMinstroy } from "@/lib/minstroy";
import { SEED } from "@/lib/seed";

const file = (year: number, zone: string, rows: [string, number, number][]) => {
  const wb = XLSX.utils.book_new();
  const head = (part: string) => [[`Индексы изменения сметной стоимости к группам однородных строительных ресурсов (${part}) для ценовой зоны ${zone} на 3 квартал ${year} года`],
    ["Код ресурса", "Наименование", "Единица", "Сметная цена в уровне цен на 01.01.2022, руб.", "Номер группы", "Группа", "Индекс изменения сметной стоимости"], [1, 2, 3, 4, 5, 6, 7]];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([...head("Часть 1. Материалы"), ...rows.slice(0, -1).map(([c, p, v]) => [c, "x", "т", p, 1, "г", v])]), "Материалы и оборудование");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([...head("Часть 2. Машины и механизмы"), ...rows.slice(-1).map(([c, p, v]) => [c, "x", "маш.-ч", p, 1, "г", v])]), "Машины и механизмы");
  return parseMinstroy(XLSX.write(wb, { type: "array", bookType: "xlsx" }), `${year}.xlsx`, SEED.regions);
};

describe("индексы Минстроя из файлов ФГИС ЦС", () => {
  it("рост за год — по корзине ресурсов с весами по сметной цене 2022; регион из шапки; зоны усредняются", () => {
    const z1 = "Ханты-Мансийский автономный округ - Югра (1 зона), г. Нижневартовск", z2 = "Ханты-Мансийский автономный округ - Югра (2 зона), г. Сургут";
    const a = file(2025, z1, [["01", 100, 2], ["02", 300, 1], ["91", 100, 3]]);
    const b = file(2026, z1, [["01", 100, 2.2], ["02", 300, 1], ["91", 100, 3.3], ["99", 50, 9]]);
    expect(a).toMatchObject({ region: "71100", quarter: 3, year: 2025, materials: 2, machines: 1 });
    const [r] = minstroyByRegion([a, b]);
    // (100·2,2 + 300·1 + 100·3,3) / (100·2 + 300·1 + 100·3) = 850 / 800
    expect(r.value).toBeCloseTo(850 / 800, 6);
    expect(r.period).toBe("3 кв. 2026 к 3 кв. 2025");
    const c = file(2025, z2, [["01", 100, 1], ["91", 100, 1]]), d = file(2026, z2, [["01", 100, 1.1], ["91", 100, 1.1]]);
    expect(minstroyByRegion([a, b, c, d])[0].value).toBeCloseTo((850 / 800 + 1.1) / 2, 6);
  });
  it("без файла за тот же квартал прошлого года роста нет", () => {
    const [r] = minstroyByRegion([file(2026, "Томская область", [["01", 1, 1], ["91", 1, 1]])]);
    expect(r).toMatchObject({ region: "69", value: null });
  });
});
