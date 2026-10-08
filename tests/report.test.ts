import { describe, expect, it } from "vitest";
import { avgGrowth, groupSplit, splitGrowth } from "@/lib/report";
import type { ForecastRow } from "@/lib/forecast";

const row = (p: Partial<ForecastRow>): ForecastRow => ({
  okpd2: "01", okpd2Name: "", category: null, ws: null, subject: "x", unit: "шт", unitLabel: "шт", region: null, regionName: null,
  contracts: 3, outliers: 0, minPrice: 0, maxPrice: 0, basePrice: 100, forecastIndex: 1, indexLevel: "okpd2", indexSource: "", indexSourceUrl: "",
  forecastPrice: 100, prices: [], rawMedian: 100, outlierPrices: [], toDecember: "none", indexKey: null, indexApproved: true, indexSourceCode: null,
  repeatable: true, needsApproval: false, smallSample: false, flags: [], comment: "", ...p,
});

describe("отчёт: раскладка роста", () => {
  it("сумма частей равна итогу, итог равен среднему росту шапки", () => {
    const rows = [
      row({ rawMedian: 100, basePrice: 104, forecastPrice: 110, toDecember: "applied" }),
      row({ rawMedian: 200, basePrice: 200, forecastPrice: 214, toDecember: "none" }),
      row({ rawMedian: 50, basePrice: 51, forecastPrice: 60, toDecember: "partial" }),
    ];
    const s = splitGrowth(rows);
    expect(s.total).toBeCloseTo(avgGrowth(rows), 10);
    expect(s.intra + s.industry).toBeCloseTo(s.total, 10);
    expect(s.intra).toBeGreaterThan(0);
  });
  it("без пересчёта по месяцам первая часть равна нулю", () => {
    const s = splitGrowth([row({ basePrice: 100, forecastPrice: 107.1 })]);
    expect(s.intra).toBe(0);
    expect(s.industry).toBeCloseTo(7.1, 10);
  });
  it("группы отсортированы по убыванию роста, части каждой сходятся", () => {
    const g = groupSplit([row({ subject: "a", forecastPrice: 105 }), row({ subject: "b", forecastPrice: 110 }), row({ subject: "a", forecastPrice: 103 })], (r) => r.subject);
    expect(g.map((x) => x.key)).toEqual(["b", "a"]);
    for (const x of g) expect(x.intra + x.industry).toBeCloseTo(x.total, 10);
  });
});

import { districtOf } from "@/lib/districts";
describe("федеральные округа", () => {
  it("по коду ОКАТО", () => {
    expect(districtOf("40")).toBe("Северо-Западный");
    expect(districtOf("45")).toBe("Центральный");
    expect(districtOf("71100")).toBe("Уральский");
    expect(districtOf(null)).toBeNull();
  });
});

import { radialMax } from "@/lib/report";
describe("шкала колец", () => {
  it("не меньше 10 %, иначе максимум, округлённый вверх, × 1,5", () => {
    expect(radialMax(4.8)).toBe(10);
    expect(radialMax(9.6)).toBe(15);
    expect(radialMax(12.1)).toBe(19.5);
  });
});
