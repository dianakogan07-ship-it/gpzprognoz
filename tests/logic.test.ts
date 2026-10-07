import { describe, expect, it } from "vitest";
import { buildForecast } from "@/lib/forecast";
import { explainExample, lastDataMonth } from "@/lib/logic";
import { SEED } from "@/lib/seed";
import type { PriceIndex, Reference } from "@/lib/types";

const ix = (p: Partial<PriceIndex>): PriceIndex => ({ id: 0, kind: "forecast", key: null, year: 2027, month: null, value: 1, source_code: null, approved: true, note: null, ...p });
const base = SEED.indices.filter((i) => i.kind !== "to_december" && i.year !== 2027);
const ref = (extra: PriceIndex[]): Reference => ({ ...SEED, indices: [...base, ...extra] });
const demo = { okpd2: "01", month: 2, price: 1_000_000, vat: 0.22 };

describe("логика расчётов", () => {
  it("последний месяц с данными — следующий после последнего месяца договора", () => {
    const r = ref([ix({ id: 1, kind: "to_december", key: "01", year: 2026, month: 2, value: 1.04 }), ix({ id: 2, kind: "to_december", key: "01", year: 2026, month: 7, value: 1.01 })]);
    expect(lastDataMonth(r.indices, 2026)).toBe(8);
    expect(lastDataMonth(r.indices, 2025)).toBeNull();
  });

  it("пример совпадает с расчётом сервиса и берёт отраслевой индекс", () => {
    const r = ref([ix({ id: 1, kind: "to_december", key: "01", year: 2026, month: 2, value: 1.04 }), ix({ id: 2, key: "01", value: 1.05 }), ix({ id: 3, kind: "cpi", value: 1.04 })]);
    const e = explainExample(r, demo, 2026, 2027);
    expect(e.toDecOff).toBe(false);
    expect(e.toDec?.value).toBe(1.04);
    expect(e.growth?.value).toBe(1.05);
    expect(e.forecastPrice).toBe(1_092_000);
    expect(e.withVat).toBe(1_332_240);
    expect(e.needsApproval).toBe(false);
    const svc = buildForecast(
      [{ row: 1, lot: "L", procId: null, subject: "x", okpd2: "01", unit: "шт", unitName: null, method: null, quantity: 1, region: null, category: null, ws: null, vatRate: 0.22 }],
      [{ row: 1, lot: "L", procId: null, status: null, priceNoVat: 1_000_000, quantity: 1, contractDate: new Date(Date.UTC(2026, 1, 10)), ws: null, vatRate: null }],
      r, { baseYear: 2026, targetYear: 2027 });
    expect(svc.rows[0].forecastPrice).toBe(e.forecastPrice);
    expect(svc.rows[0].vatRate).toBe(0.22);
  });

  it("без отраслевого индекса — общая инфляция и согласование; без пересчёта внутри года — шаг пропущен", () => {
    const e = explainExample(ref([ix({ id: 3, kind: "cpi", value: 1.04 })]), demo, 2026, 2027);
    expect(e.toDecOff).toBe(true);
    expect(e.growth).toBeNull();
    expect(e.cpi?.value).toBe(1.04);
    expect(e.forecastPrice).toBe(1_040_000);
    expect(e.needsApproval).toBe(true);
  });
});
