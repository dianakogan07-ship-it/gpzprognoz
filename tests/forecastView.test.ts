import { describe, expect, it } from "vitest";
import type { ForecastRow } from "@/lib/forecast";
import { unitLabel } from "@/lib/forecast";
import {
  EMPTY_FILTERS, actionHint, filterExcluded, filterRows, filtersFromQuery, filtersToQuery, matchesOkpd,
  reasonGroup, reasonsOf, sortRows, statusOf, toViewRows, type Filters,
} from "@/lib/forecastView";
import { SEED } from "@/lib/seed";

const base: ForecastRow = {
  okpd2: "28.99", okpd2Name: "Оборудование", category: "МТР", ws: null, subject: "Установка", unit: "шт", unitLabel: "шт",
  region: "40", regionName: "г. Санкт-Петербург", contracts: 5, outliers: 0, minPrice: 90, maxPrice: 110, basePrice: 100,
  forecastIndex: 1.08, indexLevel: "okpd2", indexSource: "МЭР", indexSourceUrl: "", forecastPrice: 108,
  prices: [90, 100, 110], rawMedian: 100, outlierPrices: [], toDecember: "applied", indexKey: "28", indexApproved: true,
  indexSourceCode: "MER_FORECAST", repeatable: true, needsApproval: false, smallSample: false, flags: [], comment: "",
};
const row = (p: Partial<ForecastRow>): ForecastRow => ({ ...base, ...p });
const F = (p: Partial<Filters>): Filters => ({ ...EMPTY_FILTERS, ...p });

describe("статус позиции", () => {
  it("«Надёжно»: отраслевой утверждённый индекс и не меньше трёх договоров", () => {
    expect(statusOf(row({}))).toBe("reliable");
    expect(statusOf(row({ contracts: 3, indexLevel: "okved2" }))).toBe("reliable");
    expect(reasonsOf(row({}))).toEqual([]);
  });
  it("«Проверить»: общая инфляция, неутверждённый индекс, нет пересчёта до декабря, неизвестная повторяемость", () => {
    expect(reasonsOf(row({ indexLevel: "cpi", indexApproved: true }))).toEqual(["cpi"]);
    expect(reasonsOf(row({ indexApproved: false }))).toEqual(["unapproved"]);
    expect(reasonsOf(row({ toDecember: "none" }))).toEqual(["not_december"]);
    expect(reasonsOf(row({ toDecember: "partial" }))).toEqual(["not_december"]);
    expect(reasonsOf(row({ toDecember: "not_needed" }))).toEqual([]);
    expect(reasonsOf(row({ repeatable: null }))).toEqual(["repeat_unknown"]);
    expect(reasonsOf(row({ indexLevel: "cpi", indexApproved: null }))).toEqual(["no_index"]);
    for (const p of [{ indexLevel: "cpi" as const }, { indexApproved: false }, { toDecember: "none" as const }, { repeatable: null }]) {
      expect(statusOf(row(p))).toBe("check");
    }
  });
  it("«Мало данных»: 1–2 договора, даже если есть другие причины", () => {
    expect(statusOf(row({ contracts: 1 }))).toBe("lowdata");
    expect(statusOf(row({ contracts: 2, indexLevel: "cpi" }))).toBe("lowdata");
    expect(reasonsOf(row({ contracts: 2, indexLevel: "cpi" }))).toEqual(["cpi", "few_contracts"]);
  });
  it("разовая закупка сама по себе не требует проверки", () => {
    expect(statusOf(row({ repeatable: false }))).toBe("reliable");
  });
});

describe("фильтрация", () => {
  const rows = toViewRows([
    row({ subject: "Бумага офисная", okpd2: "17.12.14", category: "Товары административно-хозяйственного назначения", forecastIndex: 1.05, repeatable: true }),
    row({ subject: "Аренда офиса", okpd2: "68.20.12", category: "Услуги/работы общего профиля", region: "45", regionName: "г. Москва", contracts: 1, forecastIndex: 1.04, indexLevel: "cpi" }),
    row({ subject: "Насос центробежный", okpd2: "28.13.14", contracts: 12, forecastIndex: 1.12, repeatable: false }),
    row({ subject: "Услуги по добыче", okpd2: "09.10.12", contracts: 3, forecastIndex: 0.98, indexLevel: "okved2", repeatable: null }),
  ]);
  const subj = (f: Filters) => filterRows(rows, f).map((v) => v.row.subject);

  it("без фильтров возвращает все строки", () => expect(subj(EMPTY_FILTERS)).toHaveLength(4));
  it("поиск по предмету и коду ОКПД2, без учёта регистра и порядка слов", () => {
    expect(subj(F({ q: "НАСОС" }))).toEqual(["Насос центробежный"]);
    expect(subj(F({ q: "68.20" }))).toEqual(["Аренда офиса"]);
    expect(subj(F({ q: "офисная бумага" }))).toEqual(["Бумага офисная"]);
  });
  it("статус, категория, регион", () => {
    expect(subj(F({ status: ["lowdata"] }))).toEqual(["Аренда офиса"]);
    expect(subj(F({ status: ["check", "lowdata"] }))).toEqual(["Аренда офиса", "Услуги по добыче"]);
    expect(subj(F({ category: ["МТР"] }))).toEqual(["Насос центробежный", "Услуги по добыче"]);
    expect(subj(F({ region: ["45"] }))).toEqual(["Аренда офиса"]);
  });
  it("префикс ОКПД2", () => {
    expect(subj(F({ okpd: "28" }))).toEqual(["Насос центробежный"]);
    expect(subj(F({ okpd: "09.10" }))).toEqual(["Услуги по добыче"]);
    expect(subj(F({ okpd: "09.1" }))).toEqual([]);
    expect(matchesOkpd("28.13.14", "28.13.")).toBe(true);
    expect(matchesOkpd("28.13.14", "2")).toBe(true);
  });
  it("источник индекса, число договоров, повторяемость", () => {
    expect(subj(F({ source: ["cpi"] }))).toEqual(["Аренда офиса"]);
    expect(subj(F({ source: ["okved2"] }))).toEqual(["Услуги по добыче"]);
    expect(subj(F({ contracts: ["1"] }))).toEqual(["Аренда офиса"]);
    expect(subj(F({ contracts: ["2-4"] }))).toEqual(["Услуги по добыче"]);
    expect(subj(F({ contracts: ["5+"] }))).toEqual(["Бумага офисная", "Насос центробежный"]);
    expect(subj(F({ repeat: ["no"] }))).toEqual(["Насос центробежный"]);
    expect(subj(F({ repeat: ["unknown"] }))).toEqual(["Услуги по добыче"]);
  });
  it("рост от … до … %, включая отрицательный", () => {
    expect(subj(F({ growthMin: 5 }))).toEqual(["Бумага офисная", "Насос центробежный"]);
    expect(subj(F({ growthMax: 0 }))).toEqual(["Услуги по добыче"]);
    expect(subj(F({ growthMin: 4, growthMax: 5 }))).toEqual(["Бумага офисная", "Аренда офиса"]);
  });
  it("фильтры сочетаются через «и»", () => {
    expect(subj(F({ category: ["МТР"], growthMin: 10 }))).toEqual(["Насос центробежный"]);
  });
  it("сортировка по прогнозу и предмету", () => {
    const r2 = toViewRows([row({ subject: "Б", forecastPrice: 5 }), row({ subject: "а", forecastPrice: 50 }), row({ subject: "В", forecastPrice: 1 })]);
    expect(sortRows(r2, "forecast", "desc").map((v) => v.row.subject)).toEqual(["а", "Б", "В"]);
    expect(sortRows(r2, "subject", "asc").map((v) => v.row.subject)).toEqual(["а", "Б", "В"]);
    expect(sortRows(r2, null, "asc")).toBe(r2);
  });
  it("тысячи строк фильтруются быстро", () => {
    const big = toViewRows(Array.from({ length: 20000 }, (_, i) => row({ subject: `Позиция ${i}`, okpd2: `${10 + (i % 80)}.${i % 9}`, forecastIndex: 1 + (i % 20) / 100 })));
    const t = performance.now();
    for (let k = 0; k < 10; k++) filterRows(big, F({ q: "позиция 1", okpd: "2", growthMin: 3, status: ["reliable"] }));
    expect((performance.now() - t) / 10).toBeLessThan(50);
  });
});

describe("фильтры в адресной строке", () => {
  it("сохраняются и восстанавливаются без потерь", () => {
    const f = F({ q: "насос 28", status: ["check", "lowdata"], category: ["МТР", "Производственные работы/услуги"], region: ["40", "71100"],
      okpd: "09.10", source: ["cpi"], contracts: ["5+"], growthMin: -2.5, growthMax: 10, repeat: ["unknown"], sort: "forecast", dir: "desc",
      exFile: ["ГПЗ"], exReason: ["Договор не заключён"] });
    expect(filtersFromQuery(filtersToQuery(f))).toEqual(f);
  });
  it("пустые фильтры — пустая строка; мусор в адресе игнорируется", () => {
    expect(filtersToQuery(EMPTY_FILTERS)).toBe("");
    expect(filtersFromQuery("st=check~bad&n=7&sort=hack:desc&gmin=abc")).toEqual(F({ status: ["check"] }));
  });
});

describe("подсказка к действию и исключённые строки", () => {
  it("одна причина у ≥ 80 % позиций — общая плашка", () => {
    const rows = toViewRows([...Array(9)].map(() => row({ indexLevel: "cpi" })).concat(row({})));
    expect(actionHint(rows)).toMatchObject({ reason: "cpi", count: 9, href: "/indices" });
    expect(actionHint(rows)?.text).toBe("Для 9 позиций применена общая инфляция — добавьте отраслевые индексы, чтобы прогноз стал точнее");
    expect(actionHint(toViewRows([row({ indexLevel: "cpi" }), row({}), row({})]))).toBeNull();
    expect(actionHint([])).toBeNull();
  });
  it("фильтр «Не вошли в расчёт» по файлу и причине", () => {
    const ex = [
      { file: "ГПЗ" as const, row: 5, lot: "1", reason: "Договор не заключён: «Не размещена»" },
      { file: "ГПЗ" as const, row: 6, lot: "2", reason: "Нет в отчётности (договор не заключён)" },
      { file: "Отчётность" as const, row: 7, lot: "3", reason: "Нет в ГПЗ" },
    ];
    expect(reasonGroup(ex[0].reason)).toBe("Договор не заключён");
    expect(reasonGroup(ex[1].reason)).toBe("Нет в отчётности");
    expect(filterExcluded(ex, { exFile: ["ГПЗ"], exReason: [] }).map((e) => e.row)).toEqual([5, 6]);
    expect(filterExcluded(ex, { exFile: [], exReason: ["Нет в ГПЗ"] }).map((e) => e.row)).toEqual([7]);
  });
});

describe("единица измерения", () => {
  it("код ОКЕИ и полное наименование переводятся в краткое обозначение", () => {
    expect(unitLabel("796", SEED)).toBe("шт");
    expect(unitLabel("6", SEED)).toBe("м");
    expect(unitLabel("Комплект", SEED)).toBe("компл");
    expect(unitLabel("КОМПЛ", SEED)).toBe("компл");
    expect(unitLabel("Месяц", SEED)).toBe("мес");
    expect(unitLabel("усл. ед.", SEED)).toBe("усл. ед");
    expect(unitLabel("баррель", SEED)).toBe("баррель");
  });
});
