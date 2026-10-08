import { describe, expect, it } from "vitest";
import { canTransition, hasNewIndices, isFrozen, mape, statsOf, type SnapshotIndex } from "@/lib/forecasts/model";
import { aggregateForecast, groupKey, type ContractPoint } from "@/lib/forecast";
import { SEED } from "@/lib/seed";

describe("статусы прогноза", () => {
  it("В работе / Утверждён / Отклонён меняются свободно, из архива — никуда", () => {
    expect(canTransition("draft", "review")).toBe(true);
    expect(canTransition("review", "approved")).toBe(true);
    expect(canTransition("approved", "archived")).toBe(true);
    expect(canTransition("review", "draft")).toBe(true);
    expect(canTransition("draft", "approved")).toBe(true);
    expect(canTransition("approved", "rejected")).toBe(true);
    expect(canTransition("rejected", "draft")).toBe(true);
    expect(isFrozen("rejected")).toBe(false);
    expect(canTransition("archived", "draft")).toBe(false);
    expect(isFrozen("approved")).toBe(true);
    expect(isFrozen("review")).toBe(false);
  });
});

describe("агрегаты версии", () => {
  it("средний рост, проверено, правки", () => {
    const s = statsOf([
      { base_price: 100, forecast_price: 110, contracts: 3, needs_review: true, reviewed: true, manually_edited: false },
      { base_price: 100, forecast_price: 104, contracts: 1, needs_review: true, reviewed: false, manually_edited: true },
      { base_price: 200, forecast_price: 210, contracts: 2, needs_review: false, reviewed: false, manually_edited: false },
    ], 5);
    expect(s).toEqual({ items: 3, contracts: 6, baseSum: 400, forecastSum: 424, growth: 6, needsReview: 2, reviewed: 1, edits: 1, excluded: 5 });
  });
  it("точность по факту", () => {
    expect(mape([{ forecast: 110, actual: 100 }, { forecast: 90, actual: 100 }])).toBe(10);
    expect(mape([])).toBeNull();
  });
});

describe("новые индексы", () => {
  const ix = (p: Partial<SnapshotIndex>): SnapshotIndex => ({ id: 1, kind: "forecast", key: "C", year: 2027, month: null, value: 1.05, approved: true, source: null, url: null, loadedAt: null, ...p });
  it("бейдж — при новом, изменённом или утверждённом индексе; удалённый индекс не считается", () => {
    const snap = [ix({}), ix({ id: 2, kind: "cpi", key: null, value: 1.04, approved: false })];
    expect(hasNewIndices(snap, snap)).toBe(false);
    expect(hasNewIndices([ix({ value: 1.06 })], snap)).toBe(true);
    expect(hasNewIndices([ix({}), ix({ id: 2, kind: "cpi", key: null, value: 1.04, approved: true })], snap)).toBe(true);
    expect(hasNewIndices([ix({}), ix({ id: 3, key: "F" })], snap)).toBe(true);
    expect(hasNewIndices([ix({})], snap)).toBe(false);
  });
});

describe("пересчёт сохранённых договоров", () => {
  it("по [цена, месяц] даёт тот же результат, что и первичный расчёт", () => {
    const pts: ContractPoint[] = [100, 110, 120].map((raw, i) => ({ okpd2: "43.21", unit: "шт", region: "40", ws: null, category: "МТР", method: "Аукцион", subject: "", raw, month: 3 + i }));
    const ref = { ...SEED, indices: [...SEED.indices, { id: 9, kind: "forecast" as const, key: "F", year: 2027, month: null, value: 1.1, source_code: null, approved: true, note: null }] };
    const [a] = aggregateForecast(pts, ref, { baseYear: 2026, targetYear: 2027 });
    const restored = (a.points ?? []).map((p) => ({ ...pts[0], raw: p.raw, month: p.month }));
    const [b] = aggregateForecast(restored, ref, { baseYear: 2026, targetYear: 2027 });
    expect(b.forecastPrice).toBe(a.forecastPrice);
    expect(a.forecastPrice).toBe(121);
    expect(a.method).toBe("Аукцион");
    expect(groupKey(a)).toBe("43.21|шт|40|");
  });
});
