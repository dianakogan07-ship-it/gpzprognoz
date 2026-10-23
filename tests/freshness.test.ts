import { describe, expect, it } from "vitest";
import { staleness } from "@/lib/freshness";
import type { PriceIndex } from "@/lib/types";

const ix = (p: Partial<PriceIndex>): PriceIndex => ({ id: 1, kind: "forecast", key: "C", year: 2027, month: null, value: 1.05, approved: true, source_code: "MER_FORECAST", note: null, ...p });
const at = (s: string) => new Date(s);
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("напоминания об устаревших данных", () => {
  const fresh = [
    ix({ loaded_at: "2026-09-25T00:00:00Z" }), ix({ id: 2, kind: "cpi", key: null, loaded_at: "2026-10-10T00:00:00Z" }),
    ...[1, 2, 3, 4, 5, 6, 7].map((m) => ix({ id: 10 + m, kind: "to_december", key: "C", year: 2026, month: m, source_code: "ROSSTAT_ICP", loaded_at: "2026-09-25T00:00:00Z" })),
  ];
  it("всё свежее — напоминаний нет", () => expect(staleness(fresh, 2027, 2026, at("2026-10-19"))).toEqual([]));
  it("МЭР загружен до сентябрьской публикации — пора обновить", () => {
    const old = fresh.map((i) => (i.kind !== "to_december" ? { ...i, loaded_at: "2026-05-01T00:00:00Z" } : i));
    expect(ids(staleness(old, 2027, 2026, at("2026-10-19")))).toEqual(["mer"]);
    // после октябрьского опроса Банка России инфляцию тоже пора обновить
    expect(ids(staleness(old, 2027, 2026, at("2026-11-05")))).toEqual(expect.arrayContaining(["mer", "cbr"]));
    // в сентябре новый прогноз ещё могли не опубликовать — не торопим
    expect(ids(staleness(old, 2027, 2026, at("2026-09-15")))).not.toContain("mer");
  });
  it("инфляция загружена после октябрьского опроса — обновлять до следующего года не нужно; Росстат отстаёт на месяц", () => {
    expect(ids(staleness(fresh, 2027, 2026, at("2026-11-20")))).toEqual(["rosstat"]);
    expect(staleness(fresh, 2027, 2026, at("2026-11-20")).find((s) => s.id === "rosstat")?.reason).toBe("последние данные — за август 2026, уже опубликован сентябрь");
  });
  it("нет прогноза на год — напоминание сразу", () => expect(ids(staleness([], 2028, 2027, at("2026-10-19")))).toEqual(["mer", "cbr"]));
});
