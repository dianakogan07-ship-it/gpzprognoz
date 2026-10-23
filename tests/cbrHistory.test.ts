import { expect, test } from "vitest";
import { readFileSync } from "fs";
import { parseCbrHistory, surveyFor } from "@/lib/cbrHistory";

test("история опросов Банка России: прогноз на год — из октябрьского опроса прошлого года", () => {
  const b = readFileSync("tests/fixtures/cbr-survey-history.xlsx");
  const h = parseCbrHistory(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const s24 = surveyFor(h, 2024)!;
  expect(s24.date.slice(0, 7)).toBe("2023-10");
  expect(s24.values[2024]).toBe(6.6);
  for (const y of [2024, 2025, 2026, 2027]) console.log(y, surveyFor(h, y)?.date, surveyFor(h, y)?.values[y]);
});
