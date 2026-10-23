import { expect, test } from "vitest";
import { readFileSync } from "fs";
import { pdfToPages } from "@/lib/mer/pdf";
import { parseCbrSurvey } from "@/lib/cbr";

test("опрос Банка России: инфляция в среднем за год по годам", async () => {
  const s = parseCbrSurvey(await pdfToPages(new Uint8Array(readFileSync("tests/fixtures/cbr-survey-2026-10.pdf"))));
  expect(s.date).toBe("14 октября 2026 года");
  expect(s.cpiAvg).toEqual({ 2021: 6.7, 2022: 13.8, 2023: 5.9, 2024: 8.4, 2025: 8.7, 2026: 6.2, 2027: 5.8, 2028: 4.5, 2029: 4 });
  expect(s.cpiAvgPrev[2027]).toBe(5.2);
  expect(s.facts).toEqual([2021, 2022, 2023, 2024, 2025]);
}, 60000);
