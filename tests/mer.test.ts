import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { expandCodes, indicatorOf, parseCodeInput, parseGroup, parseMer, toCoef } from "@/lib/mer/parse";
import { pdfToPages } from "@/lib/mer/pdf";
import { xlsxToPages } from "@/lib/mer/xlsx";
import { planMerCommit, summarize, type MerIncoming } from "@/lib/mer/plan";
import type { PriceIndex } from "@/lib/types";

const byCode = (r: ReturnType<typeof parseMer>) => Object.fromEntries(r.rows.map((x) => [x.kind === "cpi" ? "ИПЦ" : x.codeText || x.raw.slice(0, 30), x]));

describe("разбор подписей", () => {
  it("коды ОКВЭД2 и разделы", () => {
    expect(parseGroup("Добыча полезных ископаемых (Раздел B)")).toEqual({ keys: ["B"], codeText: "Раздел B" });
    expect(parseGroup("Строительство (раздел F)")?.keys).toEqual(["F"]);
    expect(parseGroup("Строительство (раздел Ғ)")).toBeNull();
    expect(parseGroup("Раздел С — обрабатывающие производства")?.keys).toEqual(["C"]); // кириллическая «С»
    expect(parseGroup("Добыча угля (05)")).toEqual({ keys: ["05"], codeText: "05" });
    expect(parseGroup("Нефть и газ (06+09)")).toEqual({ keys: ["06", "09"], codeText: "06+09" });
    expect(parseGroup("Пищевые продукты (10–12)")?.keys).toEqual(["10", "11", "12"]);
    expect(parseGroup("Всего по экономике")).toBeNull();
    expect(parseGroup("Индекс (в % к предыдущему году)")).toBeNull();
    expect(expandCodes("06+09, 10-11")).toEqual(["06", "09", "10", "11"]);
  });
  it("вид показателя и значение", () => {
    expect(indicatorOf("индекс-дефлятор")).toBe("deflator");
    expect(indicatorOf("Индекс цен производителей")).toBe("icp");
    expect(indicatorOf("ИЦП")).toBe("icp");
    expect(indicatorOf("Добыча угля (05)")).toBeNull();
    expect(toCoef("104,5")).toEqual({ value: 1.045 });
    expect(toCoef("99,9").value).toBe(0.999);
    expect(toCoef("4,5").value).toBe(1.045); // прирост в %
    expect(toCoef("-2,3").value).toBe(0.977);
    expect(toCoef("450").value).toBeNull();
  });
  it("коды из поля ввода в предпросмотре", () => {
    expect(parseCodeInput("06+09")).toEqual(["06", "09"]);
    expect(parseCodeInput("Раздел В")).toEqual(["B"]);
    expect(parseCodeInput("f")).toEqual(["F"]);
    expect(parseCodeInput("43.2")).toEqual(["43.2"]);
    expect(parseCodeInput("Ж")).toEqual([]);
    expect(parseCodeInput("6+9")).toEqual([]);
    expect(parseCodeInput("")).toEqual([]);
  });
});

describe("прогноз МЭР в PDF", async () => {
  const pages = await pdfToPages(new Uint8Array(readFileSync(path.join(__dirname, "fixtures/mer-sample.pdf"))));
  const res = parseMer(pages, 2027);
  const r = byCode(res);

  it("находит документ, дату одобрения и таблицу", () => {
    expect(res.title).toBe("Прогноз социально-экономического развития Российской Федерации на 2026 год и на плановый период 2027 и 2028 годов");
    expect(res.approvedDate).toBe("18 сентября 2025");
    expect(res.tablePage).toBe("стр. 2");
    expect(res.warnings).toEqual([]);
  });
  it("берёт базовый вариант на целевой год; при ИЦП и дефляторе — ИЦП, дефлятор справочно", () => {
    expect(r["Раздел B"]).toMatchObject({ keys: ["B"], indicator: "icp", value: 1.037, deflator: 1.04, problems: [] });
    expect(r["Раздел C"]).toMatchObject({ indicator: "icp", value: 1.046, deflator: 1.043 });
    expect(r["06+09"]).toMatchObject({ keys: ["06", "09"], indicator: "deflator", value: 1.038, deflator: null, problems: [] });
  });
  it("склеивает подпись, перенесённую на вторую строку, и продолжает таблицу на следующей странице", () => {
    expect(r["10-12"]).toMatchObject({ keys: ["10", "11", "12"], value: 1.044 });
    expect(r["10-12"].raw).toContain("Производство пищевых продуктов, напитков");
    expect(r["Раздел F"]).toMatchObject({ value: 1.051, page: "стр. 3" });
  });
  it("неоднозначные строки помечены: нет кода или не ясен вид показателя", () => {
    expect(r["05"].problems).toEqual(["не определено, ИЦП это или дефлятор"]);
    const total = res.rows.find((x) => x.raw.startsWith("Промышленное производство"))!;
    expect(total.keys).toEqual([]);
    expect(total.problems).toContain("не определён код ОКВЭД2");
  });
  it("ИПЦ — среднегодовой, из другой таблицы, и не путается со строками ИЦП", () => {
    expect(r["ИПЦ"]).toMatchObject({ kind: "cpi", value: 1.04, problems: [] });
    expect(r["ИПЦ"].raw).toContain("в среднем за год");
    expect(res.rows.filter((x) => x.kind === "forecast")).toHaveLength(7);
  });
  it("другой целевой год берётся из своей колонки", () => {
    expect(byCode(parseMer(pages, 2028))["Раздел F"]?.value).toBe(1.046);
  });
});

describe("прогноз МЭР в Excel", () => {
  const aoa = [
    ["Прогноз социально-экономического развития Российской Федерации на 2026 год и на плановый период 2027 и 2028 годов"],
    [],
    ["Таблица 3. Прогноз индексов цен производителей и индексов-дефляторов по видам экономической деятельности"],
    ["Показатель", "2024", "2025", "2026", null, "2027", null],
    [null, "отчет", "оценка", "базовый", "консервативный", "базовый", "консервативный"],
    ["Добыча полезных ископаемых (Раздел B)"],
    ["индекс-дефлятор", 110.2, 103.1, 101.5, 100.9, 104, 103.2],
    ["индекс цен производителей", 112, 102.5, 100.8, 100.1, 103.7, 102.9],
    ["Строительство (раздел F) — индекс-дефлятор", 109.8, 108.2, 106, 106.9, 105.1, 105.8],
    [],
    ["Таблица 4. Показатели инфляции"],
    ["Показатель", "2024", "2025", "2026", null, "2027", null],
    [null, "отчет", "оценка", "базовый", "консервативный", "базовый", "консервативный"],
    ["Индекс потребительских цен в среднем за год, %", 108.4, 108.8, 105.1, 105.7, 104, 104.2],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = [{ s: { r: 3, c: 3 }, e: { r: 3, c: 4 } }, { s: { r: 3, c: 5 }, e: { r: 3, c: 6 } }, { s: { r: 11, c: 5 }, e: { r: 11, c: 6 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Табл.3");
  const res = parseMer(xlsxToPages(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer), 2027);
  const r = byCode(res);

  it("разбирает те же показатели из листа Excel", () => {
    expect(res.tablePage).toBe("лист «Табл.3»");
    expect(r["Раздел B"]).toMatchObject({ indicator: "icp", value: 1.037, deflator: 1.04, page: "лист «Табл.3»" });
    expect(r["Раздел F"]).toMatchObject({ indicator: "deflator", value: 1.051 });
    expect(r["ИПЦ"]).toMatchObject({ value: 1.04, problems: [] });
  });
});

describe("прогноз МЭР: варианты строками, ИПЦ приростом", () => {
  it("берёт строку «базовый» под показателем и понимает «4,0» как +4 %", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["ПРОГНОЗ СОЦИАЛЬНО-ЭКОНОМИЧЕСКОГО РАЗВИТИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ НА 2027 ГОД И НА ПЛАНОВЫЙ ПЕРИОД 2028 И 2029 ГОДОВ"],
      ["СЕНТЯБРЬ 2026 ГОДА"],
      ["Таблица. Основные показатели прогноза"],
      [null, "2025", "2026", "2027", "2028"],
      ["Индекс потребительских цен на конец года, в % к декабрю"],
      ["консервативный", null, null, 5.3, 4.0],
      [null, 5.6, 6.8],
      ["базовый", null, null, 4.0, 4.0],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "1");
    const res = parseMer(xlsxToPages(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer), 2027);
    expect(res.title).toBe("Прогноз социально-экономического развития Российской Федерации на 2027 год и на плановый период 2028 и 2029 годов");
    expect(res.approvedDate).toBe("сентябрь 2026");
    expect(res.rows).toEqual([expect.objectContaining({ kind: "cpi", value: 1.04, problems: [] })]);
    expect(res.rows[0].raw).toContain("базовый");
    expect(res.warnings[0]).toContain("нет таблицы индексов цен производителей");
  });
});

describe("повторная загрузка прогноза", () => {
  const ix = (p: Partial<PriceIndex>): PriceIndex => ({ id: 1, kind: "forecast", key: "B", year: 2027, month: null, value: 1.04, source_code: "MER_FORECAST", approved: true, note: null, ...p });
  const inc = (p: Partial<MerIncoming>): MerIncoming => ({ kind: "forecast", key: "B", year: 2027, value: 1.04, indicator: "icp", ref_deflator: null, raw_line: "", doc_page: "стр. 2", ...p });

  it("новые значения добавляются, неутверждённые обновляются на месте", () => {
    const plan = planMerCommit([ix({ id: 5, key: "F", approved: false, value: 1.05 })], [inc({ key: "C" }), inc({ key: "F", value: 1.06 })]);
    expect(plan[0]).toMatchObject({ type: "insert" });
    expect(plan[1]).toMatchObject({ type: "update", id: 5, change: "Было +5,0 %, обновлено из нового прогноза: +6,0 %" });
  });
  it("подтверждённый индекс не затирается: при другом значении — новая версия, при том же — без изменений", () => {
    const existing = [ix({ id: 1, value: 1.04 }), ix({ id: 2, key: "F", value: 1.05 })];
    const plan = planMerCommit(existing, [inc({ value: 1.045 }), inc({ key: "F", value: 1.05 })]);
    expect(plan[0]).toEqual({ type: "version", of: 1, pendingId: null, row: inc({ value: 1.045 }), change: "Утверждено +4,0 %, в новом прогнозе +4,5 %" });
    expect(plan[1]).toMatchObject({ type: "same", id: 2 });
    expect(summarize(plan)).toEqual({ inserted: 0, updated: 0, versions: 1, unchanged: 1 });
  });
  it("уже ожидающая проверки версия обновляется, а не дублируется; заменённые версии не учитываются", () => {
    const existing = [ix({ id: 1 }), ix({ id: 7, value: 1.045, approved: false, pending_of: 1 }), ix({ id: 9, value: 1.02, superseded_at: "2026-01-01" })];
    expect(planMerCommit(existing, [inc({ value: 1.05 })])[0]).toMatchObject({ type: "version", of: 1, pendingId: 7 });
  });
  it("ИПЦ сопоставляется без кода", () => {
    expect(planMerCommit([ix({ kind: "cpi", key: null, approved: false })], [inc({ kind: "cpi", key: null, value: 1.04 })])[0]).toMatchObject({ type: "update", change: null });
  });
});
