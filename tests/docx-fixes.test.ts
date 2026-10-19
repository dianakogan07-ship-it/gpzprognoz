import { describe, expect, it } from "vitest";
import { buildForecast, contractPrice, findIndex, okpdIn } from "@/lib/forecast";
import { resolveRegion } from "@/lib/normalize";
import { avgGrowth, splitGrowth } from "@/lib/report";
import type { GpzRow, ReportRow } from "@/lib/parse";
import type { PriceIndex } from "@/lib/types";
import { SEED } from "@/lib/seed";

const ix = (p: Partial<PriceIndex>): PriceIndex => ({ id: 1, kind: "forecast", key: "C", year: 2027, month: null, value: 1, approved: true, source_code: null, note: null, ...p });
const gpz = (p: Partial<GpzRow>): GpzRow => ({
  row: 1, lot: "L1", procId: null, subject: "Дизельное топливо", okpd2: "19.20.21.135", unit: "т", unitName: null, method: null, quantity: 1,
  region: "71100", category: "МТР", ws: null, vatRate: 0.22, regionName: null, regionError: null, workStart: null, workEnd: null, quarter: null, ...p,
});
const rep = (p: Partial<ReportRow>): ReportRow => ({
  row: 1, lot: "L1", procId: null, status: null, priceNoVat: 1000, quantity: 1, contractDate: new Date(Date.UTC(2026, 0, 15)), ws: null, vatRate: null,
  endDate: null, offerNoVat: null, comment: null, ...p,
});
const ref = (indices: PriceIndex[]) => ({ ...SEED, indices });
const idx = [
  ix({ id: 1, key: "C", value: 1.047 }),
  ix({ id: 2, key: "19.2", value: 1.059 }),
  ...[1, 2, 3, 4, 5, 6, 7].map((m) => ix({ id: 10 + m, kind: "to_december", key: "19.2", year: 2026, month: m, value: 1.426 })),
];

describe("замечания от 13.10.2026", () => {
  it("№4: индекс 19.2 подходит к коду 19.20.21.135, 19.2 и 19.20 — одна группа", () => {
    expect(okpdIn("19.20.21.135", "19.2")).toBe(true);
    expect(okpdIn("19.2", "19.20")).toBe(true);
    expect(okpdIn("19.30", "19.2")).toBe(false);
    expect(findIndex(idx.filter((i) => i.kind === "forecast"), "19.20.21.135", "C")?.index.key).toBe("19.2");
  });

  it("№5: ОКАТО 71160 — не Тюменская область, а ошибка; код сверяется с названием", () => {
    expect(resolveRegion("71160", "Ямало-Ненецкий автономный округ", SEED.regions).error).toMatch(/71160/);
    expect(resolveRegion("71160", null, SEED.regions).code).toBeNull();
    expect(resolveRegion("71140", "Ямало-Ненецкий автономный округ", SEED.regions)).toEqual({ code: "71140", error: null });
    expect(resolveRegion("71", "Ямало-Ненецкий автономный округ", SEED.regions).error).toMatch(/не совпадает/);
    expect(resolveRegion("40", "Город Санкт-Петербург город федерального значения", SEED.regions)).toEqual({ code: "40", error: null });
    expect(resolveRegion("71100", "г. Сургут", SEED.regions)).toEqual({ code: "71100", error: null });
    const res = buildForecast([gpz({ regionError: "Код ОКАТО 71160 не найден", region: null })], [rep({})], ref(idx), { baseYear: 2026, targetYear: 2027 });
    expect(res.rows).toHaveLength(0);
    expect(res.excluded[0].reason).toMatch(/71160/);
  });

  it("№1, №6: рост — от цены договора, рост внутри года и рост отрасли перемножаются", () => {
    const res = buildForecast([gpz({})], [rep({})], ref(idx), { baseYear: 2026, targetYear: 2027 });
    const r = res.rows[0];
    expect(contractPrice(r)).toBe(1000);
    expect(r.forecastPrice).toBeCloseTo(1000 * 1.426 * 1.059, 1);
    expect(avgGrowth([r])).toBeCloseTo((1.426 * 1.059 - 1) * 100, 1);
    const sp = splitGrowth([r]);
    expect(sp.intra + sp.industry).toBeCloseTo(sp.total, 6);
    expect(sp.intra).toBeCloseTo(42.6, 1);
  });

  it("№2: договор января 2027 года не пересчитывается по индексу января 2026", () => {
    const res = buildForecast([gpz({})], [rep({ contractDate: new Date(Date.UTC(2027, 0, 20)) })], ref(idx), { baseYear: 2026, targetYear: 2027 });
    const r = res.rows[0];
    expect(r.basePrice).toBe(1000);
    expect(r.toDecember).toBe("not_needed");
    expect(r.forecastPrice).toBeCloseTo(1059, 1);
    expect(res.stats.laterYear).toBe(1);
  });

  it("договор после последнего месяца с данными Росстата — шаг 2 не нужен", () => {
    const res = buildForecast([gpz({})], [rep({ contractDate: new Date(Date.UTC(2026, 9, 5)) })], ref(idx), { baseYear: 2026, targetYear: 2027 });
    expect(res.rows[0].toDecember).toBe("not_needed");
    expect(res.rows[0].basePrice).toBe(1000);
  });

  it("№7: ставка 0 % из ГПЗ без подтверждения не применяется — берётся 22 %", () => {
    const g = [gpz({ vatRate: 0 })], r = [rep({})];
    const a = buildForecast(g, r, ref(idx), { baseYear: 2026, targetYear: 2027 });
    expect(a.rows[0].vatRate).toBe(0.22);
    expect(a.rows[0].vatFile).toBe(0);
    expect(a.stats.vatOther).toEqual({ "0": 1 });
    const b = buildForecast(g, r, ref(idx), { baseYear: 2026, targetYear: 2027, trustVat: true });
    expect(b.rows[0].vatRate).toBe(0);
    expect(b.rows[0].vatFile).toBeNull();
  });

  it("допсоглашения, длинные договоры, договоры на весь год прогноза, цена лота, суммы", () => {
    const res = buildForecast(
      [gpz({ quantity: 233, quarter: 2 }), gpz({ row: 2, lot: "L2", unit: "усл ед", okpd2: "56.29.20", quantity: 1, region: "40" })],
      [rep({ priceNoVat: 18_677_000, offerNoVat: 15_937_000, quantity: null }),
        rep({ row: 2, lot: "L2", priceNoVat: 5_000_000, quantity: null, contractDate: new Date(Date.UTC(2026, 4, 15)), endDate: new Date(Date.UTC(2028, 4, 14)) })],
      ref(idx), { baseYear: 2026, targetYear: 2027 });
    const diesel = res.rows.find((r) => r.okpd2 === "19.20.21.135")!;
    expect(diesel.dsUp?.[0]).toBeCloseTo(0.172, 3);
    expect(diesel.baseSum).toBe(18_677_000);
    expect(diesel.quarters).toEqual([0, 1, 0, 0]);
    const food = res.rows.find((r) => r.okpd2 === "56.29.20")!;
    expect(food.lotPrice).toBe(true);
    expect(food.longContracts).toBe(1);
    expect(food.activeTarget).toBe(1);
    // Середина срока — май 2027: пересчёт внутри 2026 года не нужен
    expect(food.toDecember).toBe("not_needed");
  });
});
