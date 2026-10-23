"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconDownload } from "./Icons";
import { MultiSelect } from "./MultiSelect";
import type { ForecastFilters } from "./ForecastTable";
import { EMPTY_FILTERS, filterRows, reasonGroup, regionKey, type ReasonCode, type ViewRow } from "@/lib/forecastView";
import { lastDataMonth } from "@/lib/logic";
import { nmcGrowth, reserveYearsText, type Reserve } from "@/lib/forecasts/reserve";
import { RC, avgGrowth, consRatio, consRows, hasCons, evenCeil, fmtMoney, fmtNum, fmtPct, groupSplit, shortRegion, splitGrowth, sumBase, sumForecast, ticks } from "@/lib/report";
import { contractPrice } from "@/lib/forecast";
import { isActiveIndex, type PriceIndex, type Reference } from "@/lib/types";
import { MONTHS } from "@/lib/indexFormat";
import type { ExcludedRow, ForecastRow } from "@/lib/forecast";
import { plural } from "@/lib/forecastView";

const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const SOURCE_CODES = ["MER_FORECAST", "ROSSTAT_ICP", "CBR"];
const NUM = { fontVariantNumeric: "tabular-nums" } as const;

type Group = { key: string; label?: string; total: number; intra: number; industry: number };

/**
 * Отчёт для закупщиков: три листа, одинаковые на экране и в PDF.
 * Срез — общие с вкладкой «Прогноз» фильтры «Категория» и «Регион»; статус не учитывается.
 */
export function ForecastReport({ audience, view, filters, reference, year, baseYear, approved, approvedAt, title, forecastId, versionId, prevVersion, excluded, reserve = null }: {
  /** staff — внутренний отчёт: суммы ГПЗ и исходные данные расчёта; customer — для заказчиков, только проценты */
  audience: "staff" | "customer";
  view: ViewRow[]; filters: ForecastFilters; reference: Reference;
  year: number; baseYear: number; approved: boolean; approvedAt: string | null; title: string;
  forecastId: number; versionId: number; prevVersion: { id: number; number: number } | null; excluded: ExcludedRow[];
  /** Надбавка закупщиков по прошлым годам — для рекомендуемой НМЦ */
  reserve?: Reserve | null;
}) {
  const { f, set } = filters;
  const slice = useMemo(() => filterRows(view, { ...EMPTY_FILTERS, category: f.category, region: f.region }), [view, f.category, f.region]);
  const rows = useMemo(() => slice.map((v) => v.row), [slice]);
  const total = useMemo(() => splitGrowth(rows), [rows]);
  const contracts = rows.reduce((s, r) => s + r.contracts, 0);
  const cpiIx = reference.indices.find((i) => i.kind === "cpi" && i.year === year && isActiveIndex(i));
  const cpi = cpiIx ? (cpiIx.value - 1) * 100 : null;
  // Источник инфляции — из самого индекса (вкладка «Общая инфляция»)
  const cpiSourceFull = cpiIx?.source_code ? reference.sources.find((s) => s.code === cpiIx.source_code)?.name ?? cpiIx.source_code : null;
  const cpiSource = cpiSourceFull ? cpiSourceFull.split(/\s+[—-]\s+/)[0] : "источник не указан";
  const shortCat = (name: string) => reference.categories.find((c) => c.name === name)?.short_name || name || "Без категории";
  const cats = useMemo(() => groupSplit(rows, (r) => r.category ?? ""), [rows]);
  const subjects = useMemo(() => groupSplit(rows, (r) => r.subject), [rows]);

  // Сравнение с инфляцией — по округлённым до 0,1 значениям, как они показаны
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const above = cpi == null ? 0 : subjects.filter((g) => r1(g.total) > r1(cpi)).length;
  const top = subjects[0];
  // Доля суммы ГПЗ у предметов дороже инфляции: 8 мелких и 8 крупных предметов — разные ситуации
  const totalSum = rows.reduce((s, r) => s + (sumBase(r) ?? 0), 0);
  const aboveShare = cpi == null || !totalSum ? null
    : (subjects.filter((g) => r1(g.total) > r1(cpi)).reduce((s, g) => s + g.rows.reduce((t, r) => t + (sumBase(r) ?? 0), 0), 0) / totalSum) * 100;

  // Счётчики для фильтров — по всем позициям
  const counts = useMemo(() => {
    const cat = new Map<string, number>(), reg = new Map<string, { label: string; n: number }>();
    for (const v of view) {
      cat.set(v.row.category ?? "", (cat.get(v.row.category ?? "") ?? 0) + 1);
      const k = regionKey(v.row);
      const e = reg.get(k) ?? { label: v.row.regionName ?? (v.row.region || "Не указан"), n: 0 };
      e.n++; reg.set(k, e);
    }
    return { cat, reg };
  }, [view]);
  const sliceText = [
    f.category.length ? `категории: ${f.category.map((c) => c || "без категории").join(", ")}` : "все категории",
    f.region.length ? `регионы: ${f.region.map((k) => counts.reg.get(k)?.label ?? k).join(", ")}` : "все регионы",
  ].join(" · ");
  const sources = reference.sources.filter((s) => SOURCE_CODES.includes(s.code));
  const rootRef = useRef<HTMLDivElement>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  // Суммы ГПЗ конфиденциальны — только в отчёте для сотрудников (экран, PDF, Excel)
  const showMoney = audience === "staff";
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);

  async function downloadExcel() {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const add = (name: string, data: (string | number | null)[][], widths: number[]) => {
      const ws = XLSX.utils.aoa_to_sheet(data);
      ws["!cols"] = widths.map((wch) => ({ wch }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    const p1 = (v: number) => Math.round(v * 10) / 10;
    const m3 = (pct: number) => Math.round((1 + pct / 100) * 1000) / 1000;
    // Надбавка группы — средняя по категориям её позиций
    const resG = (rs: ForecastRow[]) => (reserve?.overall == null ? null : p1(rs.reduce((s, r) => s + (reserve.byCat[r.category ?? ""] ?? reserve.overall!), 0) / (rs.length || 1)));
    const hasRes = reserve?.overall != null;
    const rateRows = (gs: { key: string; total: number; rows: ForecastRow[] }[], ex: boolean) => gs.map((g) => {
      const n = g.rows.reduce((s, r) => s + r.contracts, 0);
      const res = resG(g.rows);
      return [g.key || "Без категории", ...(ex ? [[...new Set(g.rows.flatMap((r) => r.gpzNames ?? []))].slice(0, 3).join("; ")] : []), p1(g.total),
        ...(hasRes ? [res, p1(nmcGrowth(g.total, res!)), m3(nmcGrowth(g.total, res!))] : [m3(g.total)]),
        ...(audience === "staff" ? [n, reliability(n).text] : [])];
    });
    const rateHead = hasRes ? ["Рост по индексам, %", "Надбавка закупщиков, %", `Рекомендуемая НМЦ ${year}, %`, "Множитель к договору"] : ["Рост, %", "Множитель"];
    const nmcAll = hasRes ? nmcGrowth(total.total, reserve!.overall!) : null;
    const threeRows: (string | number | null)[][] = [
      [`Рост цен по индексам на ${year}, %`, p1(total.total)],
      ...(hasRes ? [[`Надбавка закупщиков (НМЦ выше договоров; ${reserveYearsText(reserve!)}), %`, reserve!.overall!], [`Рекомендуемая НМЦ на ${year} к договорам ${baseYear}, %`, nmcAll!], ["Множитель к сумме договора", m3(nmcAll!)]] : [["Множитель к сумме договора", m3(total.total)]]),
    ];
    if (audience === "customer") {
      const headC = [[`Прогноз цен ${year} — ${title}`], [`Срез: ${sliceText}. Рост к ценам договоров ${baseYear}, базовый сценарий МЭР${approved ? "" : ". Прогноз не утверждён"}`], []];
      add("Сводка", [...headC,
        ["Показатель", "Значение"],
        ...threeRows,
        ...(cpi != null ? [[`Общая инфляция, прогноз ${cpiSource}, %`, p1(cpi)]] : []),
        [],
        ["Как применить: сумма договора " + baseYear + " × множитель = рекомендуемая НМЦ на " + year + ". Проценты одинаковы для сумм с НДС и без НДС."],
      ], [60, 14]);
      add("НМЦ по категориям", [...headC, ["Категория", ...rateHead], ...rateRows(cats, false)], [48, 18, 20, 22, 18]);
      add("НМЦ по направлениям", [...headC, ["Направление", "Примеры закупок", ...rateHead], ...rateRows(subjects, true)], [50, 60, 18, 20, 22, 18]);
      add("Источники", [["Источник", "Ссылка"], ...sources.map((x) => [x.name, x.url])], [70, 70]);
      const { downloadWorkbook } = await import("@/lib/excel");
      const regs = f.region.map((k) => counts.reg.get(k)?.label ?? k);
      downloadWorkbook(wb, `Прогноз цен ${year} — ${title}${regs.length && regs.length <= 3 ? ` — ${regs.join(", ")}` : ""}${approved ? "" : " (не утверждён)"}.xlsx`.replace(/[\\/:*?"<>|]+/g, " "));
      return;
    }
    const head = [[`Прогноз цен ${year} — ${title}`], [`Срез: ${sliceText}. Расчёт по базовому сценарию МЭР${approved ? "" : ". Прогноз не утверждён"}`], []];
    add("Сводка", [...head,
      ["Показатель", "Значение", "Ед."],
      ...threeRows.map((r) => [r[0], r[1], ""]),
      ...(cpi != null ? [[`Инфляция, прогноз ${cpiSource} на ${year}`, p1(cpi), "%"]] : []),
      ["Позиций", rows.length, "шт."],
      ["Предметов закупки", subjects.length, "шт."],
      [`Договоров в основе (${baseYear})`, contracts, "шт."],
      [],
      ["Из чего складывается рост", "Значение", "Ед."],
      [`Цена договоров ${baseYear} (медиана, без НДС)`, 100, "%"],
      [`Рост цен в ${baseYear} — пересчёт до последнего месяца с данными (Росстат)`, p1(total.intra), "п.п."],
      [`Рост в ${year}: отрасль, зарплаты, курс, Минстрой`, p1(total.industry), "п.п."],
      [`Прогноз ${year} к цене договоров ${baseYear}`, p1(100 + total.total), "%"],
    ], [62, 14, 8]);
    add("Рост по категориям", [...head,
      ["Категория", `Рост цен в ${baseYear}, п.п.`, `Рост в ${year}, п.п.`, "Итого рост, %"],
      ...cats.map((c) => [c.key || "Без категории", p1(c.intra), p1(c.industry), p1(c.total)]),
    ], [48, 18, 20, 14]);
    add("НМЦ по направлениям", [...head, ["Направление", "Примеры закупок", ...rateHead, "Договоров", "Надёжность"], ...rateRows(subjects, true)], [50, 60, 18, 20, 22, 18, 12, 14]);
    add("Рост по предметам (п.п.)", [...head,
      ["Предмет закупки", `Рост цен в ${baseYear}, п.п.`, `Рост в ${year}, п.п.`, "Итого рост, %"],
      ...subjects.map((g) => [g.key, p1(g.intra), p1(g.industry), p1(g.total)]),
    ], [60, 18, 20, 14]);
    const reg = regionTable(rows).filter((x) => x.regs.length >= 2);
    if (reg.length) add("Разница цен по регионам", [...head,
      ["Предмет закупки", "Ед.", "Регион", `Цена ${baseYear}, ₽ без НДС`, `Прогноз ${year}, ₽ без НДС`, "На сколько дороже самого дешёвого региона, %"],
      ...reg.flatMap((it) => it.regs.map((r, i) => [it.subject, it.unit, r.name, Math.round(r.base * 100) / 100, Math.round(r.fc * 100) / 100,
        i === 0 ? "дешевле всего" : p1((r.fc / it.regs[0].fc - 1) * 100)])),
    ], [50, 10, 40, 20, 20, 20]);
    const r2 = (v: number) => Math.round(v * 100) / 100;
    add("Цены по предметам", [...head,
      ["Предмет закупки", "Наименование в ГПЗ", "Регион", "Ед.", `Цена ${baseYear}, ₽ без НДС`, `Прогноз ${year}, ₽ без НДС`, "Ставка НДС, %", `Прогноз ${year}, ₽ с НДС`, "Рост, %",
        `Мин. цена договоров ${baseYear}`, `Макс. цена договоров ${baseYear}`, "Договоров", "Надёжность", ...(audience === "staff" ? [`НМЦ ${year} от НМЦ ${baseYear}, ₽`, "Замечания"] : [])],
      ...[...slice].sort((x, y) => x.row.subject.localeCompare(y.row.subject, "ru")).map((v) => {
        const r = v.row, vat = r.vatRate ?? 0.22;
        return [r.subject, r.gpzNames?.[0] ?? "", r.regionName ?? "", r.unitLabel, r2(contractPrice(r)), r2(r.forecastPrice), Math.round(vat * 100), r2(r.forecastPrice * (1 + vat)), v.growth,
          r.prices.length ? Math.min(...r.prices) : null, r.prices.length ? Math.max(...r.prices) : null, r.contracts, r.contracts < 3 ? "мало данных" : "",
          ...(audience === "staff" ? [r.nmcMedian ? r2(r.nmcMedian * (r.forecastPrice / contractPrice(r))) : null, [...v.reasons.map((x) => REASON_SHORT[x]), ...(v.meta?.edited ? ["цена изменена вручную"] : [])].join("; ")] : [])];
      }),
    ], [40, 36, 26, 8, 16, 16, 8, 16, 8, 14, 14, 9, 12, 18, 50]);
    const money = moneyData(slice);
    if (money.hasSums && showMoney) {
      const r0 = (v: number) => Math.round(v);
      add("Суммы по категориям", [...head,
        ["Категория", `Сумма ${baseYear}, ₽ без НДС`, `Потребность ${year}, ₽ без НДС`, "Прирост, ₽", "Рост, %"],
        ...money.cats.map((c) => [c.key || "Без категории", r0(c.base), r0(c.fc), r0(c.fc - c.base), p1(c.base ? (c.fc / c.base - 1) * 100 : 0)]),
        ["Итого", r0(money.base), r0(money.fc), r0(money.fc - money.base), p1(money.base ? (money.fc / money.base - 1) * 100 : 0)],
        ...(money.cons ? [["Итого, консервативный сценарий МЭР", r0(money.base), r0(money.fcCons), r0(money.fcCons - money.base), p1(money.base ? (money.fcCons / money.base - 1) * 100 : 0)]] : []),
      ], [48, 22, 24, 18, 10]);
      add("Топ-10 по приросту", [...head,
        ["Позиция", "Регион", "ОКПД2", `Сумма ${baseYear}, ₽`, `Потребность ${year}, ₽`, "Прирост, ₽"],
        ...money.top.map(({ r, base, fc, d }) => [r.gpzNames?.[0] ?? r.subject, r.regionName ?? "", r.okpd2, r0(base), r0(fc), r0(d)]),
      ], [50, 30, 16, 18, 20, 16]);
    }
    if (audience === "staff") {
      const act = reference.indices.filter(isActiveIndex);
      const one = (kind: string, key: string | null = null) => act.find((i) => i.kind === kind && i.year === year && (i.key ?? null) === key);
      const pc = (i?: PriceIndex) => (i ? p1((i.value - 1) * 100) : null);
      const lm = lastDataMonth(reference.indices, baseYear);
      const used = new Map<string, (string | number | null)[]>();
      for (const r of rows) {
        const k = `${r.indexLevel}|${r.indexKey ?? ""}|${r.indexLevel === "minstroy" ? r.region : ""}`;
        const e = used.get(k) ?? [r.indexLevel === "minstroy" ? `Минстрой: ${r.regionName ?? r.region}` : `${r.indexLevel} ${r.indexKey ?? ""} ${r.indexName ?? ""}`.trim(), p1((r.forecastIndex - 1) * 100), p1(((r.forecastIndexCons ?? r.forecastIndex) - 1) * 100), 0];
        e[3] = Number(e[3]) + 1; used.set(k, e);
      }
      add("Исходные данные", [...head,
        ["Показатель", "Базовый, %", "Консервативный, %"],
        ["Общая инфляция (ИПЦ)", pc(one("cpi")), pc(one("cpi_cons"))],
        ["Рост зарплат", pc(one("wage")), pc(one("wage_cons"))],
        ["Курс доллара", pc(one("fx", "USD")), pc(one("fx_cons", "USD"))],
        [`Пересчёт внутри ${baseYear} года — до уровня`, lm ? `${MONTHS[lm - 1]} ${baseYear}` : "не загружен", null],
        [],
        ["Применённый индекс", `Рост ${year}, %`, "Консервативный, %", "Позиций"],
        ...[...used.values()].sort((a, b) => Number(b[3]) - Number(a[3])),
      ], [50, 16, 18, 10]);
    }
    add("Источники", [["Источник", "Ссылка"], ...sources.map((x) => [x.name, x.url])], [70, 70]);
    const { downloadWorkbook } = await import("@/lib/excel");
    downloadWorkbook(wb, `Внутренний отчёт — прогноз цен ${year} — ${title}${f.category.length || f.region.length ? " (срез)" : ""}${approved ? "" : " (не утверждён)"}.xlsx`.replace(/[\\/:*?"<>|]+/g, " "));
  }
  async function downloadPdf() {
    setPdfBusy(true);
    try {
      setTip(null);
      const { exportPdf } = await import("@/lib/pdfExport");
      const regs = f.region.map((k) => counts.reg.get(k)?.label ?? k);
      const name = `${audience === "staff" ? "Внутренний отчёт" : "Прогноз цен"} ${year} — ${title}${regs.length && regs.length <= 3 ? ` — ${regs.join(", ")}` : ""}${f.category.length || f.region.length ? " (срез)" : ""}${approved ? "" : " (не утверждён)"}.pdf`.replace(/[\\/:*?"<>|]+/g, " ");
      await exportPdf(rootRef.current!, name);
    } catch (e) { alert(`Не удалось сформировать PDF: ${e instanceof Error ? e.message : e}`); }
    setPdfBusy(false);
  }


  return (
    <div className="report space-y-4" style={{ color: RC.ink }}
      onMouseMove={(e) => {
        const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
        setTip(t?.dataset.tip ? { text: t.dataset.tip, x: e.clientX, y: e.clientY } : null);
      }}
      onMouseLeave={() => setTip(null)}>
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelect label="Категория" value={f.category} onChange={(category) => set({ category })}
          options={[...counts.cat.entries()].sort().map(([c, n]) => ({ value: c, label: c || "Без категории", count: n }))} />
        <MultiSelect label="Регион" searchable value={f.region} onChange={(region) => set({ region })}
          options={[...counts.reg.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, "ru")).map(([k, e]) => ({ value: k, label: e.label, count: e.n }))} />
        <span className="hidden text-xs sm:inline" style={{ color: RC.muted }}>Фильтры общие с вкладкой «Прогноз»</span>
        <span className="ml-auto text-xs" style={{ color: audience === "staff" ? RC.warn : RC.muted }}>{audience === "staff" ? "Внутренний отчёт: есть суммы ГПЗ — заказчикам не отправлять" : "Без сумм ГПЗ — можно отправлять заказчикам"}</span>
        <div className="flex gap-2">
          <button className="btn-sec" disabled={pdfBusy || !rows.length} onClick={downloadPdf}><IconDownload />{pdfBusy ? "Готовим PDF…" : "PDF"}</button>
          <button className="btn-sec" disabled={!rows.length} onClick={downloadExcel}><IconDownload />Excel</button>
        </div>
      </div>

      {audience === "customer" && (
        <p className="text-xs" style={{ color: RC.ink2 }}>{f.region.length
          ? `Отчёт для региона: ${f.region.map((k) => counts.reg.get(k)?.label ?? k).join(", ")} — проценты посчитаны только по закупкам этого региона.`
          : "Чтобы выгрузить отчёт для одного заказчика, выберите его регион в фильтре «Регион» — проценты будут посчитаны по закупкам только этого региона."}</p>
      )}
      {!rows.length ? <div className="card text-sm" style={{ color: RC.muted }}>В выбранном срезе нет позиций.</div> : (
        <div ref={rootRef} className="space-y-6">
          {audience === "customer" ? <>
            {/* Заказчику: на сколько увеличить сумму закупки — по категориям и направлениям */}
            <Sheet>
              <div>
                <h2 className="text-xl font-semibold">На сколько увеличить бюджет закупок в {year} году</h2>
                <p className="mt-0.5 text-sm" style={{ color: RC.ink2 }}>
                  {title} · {sliceText} · рост к ценам договоров {baseYear} года · расчёт по базовому сценарию МЭР{approvedAt ? ` · утверждён ${new Date(approvedAt).toLocaleDateString("ru-RU")}` : ""}
                </p>
                {!approved && <p className="mt-1 text-sm font-semibold" style={{ color: RC.warn }}>Прогноз не утверждён, цифры могут измениться</p>}
              </div>
              <ThreeNumbers growth={total.total} reserve={reserve} year={year} baseYear={baseYear} cpi={cpi} cpiSource={cpiSource} />
              <div className="rounded-lg px-4 py-3 text-xs leading-relaxed" style={{ background: RC.bg, color: RC.ink2 }}>
                <p className="font-semibold" style={{ color: RC.ink }}>Как применить</p>
                <p className="mt-0.5">Найдите свою категорию или направление ниже и умножьте сумму договора {baseYear} года на множитель рекомендуемой НМЦ. Например, договор на 10 млн ₽ при рекомендуемой НМЦ {fmtPct(reserve?.overall != null ? nmcGrowth(total.total, reserve.overall) : total.total)} — НМЦ на {year} год ≈ {fmtMoney(10_000_000 * (1 + (reserve?.overall != null ? nmcGrowth(total.total, reserve.overall) : total.total) / 100))}. Проценты одинаковы для сумм с НДС и без НДС. Договор на несколько лет — на каждый следующий год добавьте рост цен по прогнозу инфляции.</p>
              </div>
              {cats.length > 0 && <Box title="Рекомендуемая НМЦ по категориям закупок"><RateTable reserve={reserve} year={year} baseYear={baseYear} cpi={cpi} groups={cats.map((c) => ({ key: c.key, label: shortCat(c.key), total: c.total, rows: c.rows }))} /></Box>}
            </Sheet>
            {chunk(subjects, 16).map((part, i, all) => (
              <Sheet key={i}>
                <div>
                  <h2 className="text-xl font-semibold">Рекомендуемая НМЦ по направлениям закупок{all.length > 1 ? ` · ${i + 1} из ${all.length}` : ""}</h2>
                  <p className="mt-0.5 text-sm" style={{ color: RC.ink2 }}>Направление — вид товаров и услуг. Под названием — примеры закупок из плана. Сверху — направления с самым большим ростом.</p>
                </div>
                <RateTable reserve={reserve} year={year} baseYear={baseYear} cpi={cpi} examples groups={part.map((g) => ({ key: g.key, label: g.key, total: g.total, rows: g.rows }))} />
                {i === all.length - 1 && sources.length > 0 && (
                  <p className="text-[10.5px]" style={{ color: RC.muted }}>Источники:{" "}
                    {sources.map((s, k) => <span key={s.code}>{k > 0 && " · "}<a href={s.url} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: RC.blue }}>{s.name}</a></span>)}</p>
                )}
              </Sheet>
            ))}
          </> : <>
            {/* Сотруднику: итог в рублях, на чём построен расчёт, что проверить, что изменилось */}
            <Sheet>
              <div>
                <h2 className="text-xl font-semibold">Итог: ГПЗ {baseYear} → потребность {year}</h2>
                <p className="mt-0.5 text-sm" style={{ color: RC.ink2 }}>
                  {title} · {sliceText} · расчёт по базовому сценарию МЭР{approvedAt ? ` · утверждён ${new Date(approvedAt).toLocaleDateString("ru-RU")}` : ""}
                </p>
                {!approved && <p className="mt-1 text-sm font-semibold" style={{ color: RC.warn }}>Прогноз не утверждён, цифры могут измениться</p>}
              </div>
              <MoneySheet part="summary" reserve={reserve} view={slice} year={year} baseYear={baseYear} shortCat={shortCat} growth={total.total} cpi={cpi} cpiSource={cpiSource}
                plan={excluded.filter((e) => e.plan && (!f.category.length || f.category.includes(e.plan.category ?? "")) && (!f.region.length || f.region.includes(e.plan.region ?? "")))} />
              <MoneySheet part="basis" view={slice} year={year} baseYear={baseYear} shortCat={shortCat} growth={total.total} cpi={cpi} cpiSource={cpiSource} />
            </Sheet>
            <Sheet><AttentionSheet view={slice} excluded={excluded} year={year} baseYear={baseYear} reserve={reserve} /></Sheet>
            <FactSheet forecastId={forecastId} />
          </>}
        </div>
      )}

      {tip && (
        <div className="pointer-events-none fixed z-50 max-w-[260px] rounded-md px-2.5 py-1.5 text-[11.5px] leading-snug text-white"
          style={{ background: RC.ink, left: Math.min(tip.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1000) - 270), top: tip.y + 16 }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}

/** Суммы по категориям, топ-10 по приросту, надёжность расчёта, закупки по кварталам и замечания к данным */
export function moneyData(view: ViewRow[]) {
  const rows = view.map((v) => v.row);
  const withSum = rows.filter((r) => sumBase(r) != null);
  const base = withSum.reduce((s, r) => s + sumBase(r)!, 0);
  const fc = withSum.reduce((s, r) => s + sumForecast(r)!, 0);
  const fcCons = withSum.reduce((s, r) => s + sumForecast(r)! * consRatio(r), 0);
  const catMap = new Map<string, { base: number; fc: number; cons: number }>();
  for (const r of withSum) {
    const e = catMap.get(r.category ?? "") ?? { base: 0, fc: 0, cons: 0 };
    e.base += sumBase(r)!; e.fc += sumForecast(r)!; e.cons += sumForecast(r)! * consRatio(r); catMap.set(r.category ?? "", e);
  }
  const cats = [...catMap.entries()].map(([key, e]) => ({ key, ...e })).sort((a, b) => b.fc - a.fc);
  const top = withSum.map((r) => ({ r, base: sumBase(r)!, fc: sumForecast(r)!, d: sumForecast(r)! - sumBase(r)! })).sort((a, b) => b.d - a.d).slice(0, 10);
  // Надёжность: доля суммы (если сумм нет — доля позиций) по источнику цены
  const weight = (v: ViewRow) => (base ? sumBase(v.row) ?? 0 : 1);
  const all = view.reduce((s, v) => s + weight(v), 0) || 1;
  const share = (pred: (v: ViewRow) => boolean) => (view.filter(pred).reduce((s, v) => s + weight(v), 0) / all) * 100;
  const trust = [
    { label: "изменено вручную", c: RC.warn, v: share((v) => !!v.meta?.edited) },
    { label: "отраслевой индекс по коду ОКПД2", c: RC.navy, v: share((v) => !v.meta?.edited && v.row.indexLevel === "okpd2") },
    { label: "индекс раздела ОКВЭД2", c: RC.blue, v: share((v) => !v.meta?.edited && v.row.indexLevel === "okved2") },
    { label: "рост зарплат (трудоёмкие услуги)", c: RC.teal, v: share((v) => !v.meta?.edited && v.row.indexLevel === "wage") },
    { label: "Минстрой по региону (стройка)", c: RC.violet, v: share((v) => !v.meta?.edited && v.row.indexLevel === "minstroy") },
    { label: "курс валюты (валютные договоры)", c: RC.ink2, v: share((v) => !v.meta?.edited && v.row.indexLevel === "fx") },
    { label: "общая инфляция", c: RC.sky, v: share((v) => !v.meta?.edited && v.row.indexLevel === "cpi") },
  ];
  const quarters = [0, 1, 2, 3].map((q) => rows.reduce((s, r) => s + (r.quarters?.[q] ?? 0), 0));
  // Сумма по кварталам: потребность позиции делится по кварталам пропорционально числу закупок в них
  const quarterSums = [0, 1, 2, 3].map((q) => withSum.reduce((s, r) => {
    const n = (r.quarters ?? []).reduce((a, b) => a + b, 0);
    return s + (n ? (sumForecast(r)! * (r.quarters![q] ?? 0)) / n : 0);
  }, 0));
  // НМЦ: экономия на торгах и НМЦ следующего года «от НМЦ 2026 + рост»
  const withNmc = withSum.filter((r) => r.nmcSum && r.nmcContractSum);
  const nmc = withNmc.length ? {
    nmc: withNmc.reduce((s, r) => s + r.nmcSum!, 0),
    contract: withNmc.reduce((s, r) => s + r.nmcContractSum!, 0),
    nmcNext: withNmc.reduce((s, r) => s + r.nmcSum! * (r.forecastPrice / contractPrice(r)), 0),
    positions: withNmc.length,
  } : null;
  const dsByCat = new Map<string, number[]>();
  for (const r of rows) if (r.dsUp?.length) dsByCat.set(r.category ?? "", [...(dsByCat.get(r.category ?? "") ?? []), ...r.dsUp]);
  return {
    hasSums: withSum.length > 0, partial: withSum.length < rows.length, base, fc, fcCons, cons: hasCons(withSum) && Math.abs(fcCons - fc) >= Math.max(1, fc * 0.0005), cats, top, trust, byWeight: base > 0, quarters, quarterSums, nmc,
    ds: [...dsByCat.entries()].map(([k, xs]) => ({ key: k, n: xs.length, avg: (xs.reduce((s, x) => s + x, 0) / xs.length) * 100 })),
    active: rows.reduce((s, r) => s + (r.activeTarget ?? 0), 0),
    long: rows.reduce((s, r) => s + (r.longContracts ?? 0), 0),
    lots: rows.filter((r) => r.lotPrice).length,
    later: rows.reduce((s, r) => s + (r.laterYear ?? 0), 0),
  };
}


/**
 * Деньги для сотрудника. summary — сумма ГПЗ и потребность по категориям, топ-10, кварталы;
 * basis — надёжность расчёта и НМЦ
 */
function MoneySheet({ part, view, year, baseYear, shortCat, growth, cpi, cpiSource, plan = [], reserve = null }: {
  part: "summary" | "basis"; view: ViewRow[]; year: number; baseYear: number; shortCat: (n: string) => string; growth: number; cpi: number | null; cpiSource: string; reserve?: Reserve | null;
  /** Закупки из плана без договора — входят в сумму ГПЗ по НМЦ из плана */
  plan?: ExcludedRow[];
}) {
  const m = moneyData(view);
  const planNmc = plan.reduce((s, e) => s + e.plan!.nmc, 0), planNext = plan.reduce((s, e) => s + e.plan!.nmc * e.plan!.k, 0);
  const th = "py-1.5 pr-3 text-left text-[11px] font-medium uppercase tracking-wide";
  const td = "border-t py-1.5 pr-3";

  const resCat = (cat: string) => (reserve?.overall == null ? 0 : reserve.byCat[cat] ?? reserve.overall);
  const nmcSum = m.cats.reduce((sum, c) => sum + c.fc * (1 + resCat(c.key) / 100), 0);
  if (part === "summary") return (
    <>
      <ThreeNumbers growth={growth} reserve={reserve} year={year} baseYear={baseYear} cpi={cpi} cpiSource={cpiSource} />
      {!m.hasSums ? <p className="text-sm" style={{ color: RC.muted }}>В этой версии не сохранено количество — суммы появятся после повторной загрузки файлов ГПЗ и отчётности. Средний рост цен: {fmtPct(growth)}.</p> : <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Kpi label={`Сумма ГПЗ ${baseYear}`} value={fmtMoney(m.base)} note="по ценам договоров, без НДС" />
          <Kpi label={`Потребность ${year} по прогнозу цен`} value={m.cons ? <>{fmtMoney(m.fc)} <small className="text-sm font-medium" style={{ color: RC.ink2 }}>– {fmtMoney(m.fcCons)}</small></> : fmtMoney(m.fc)}
            note={m.cons ? `базовый ${fmtPct(m.base ? (m.fc / m.base - 1) * 100 : 0)} – консервативный ${fmtPct(m.base ? (m.fcCons / m.base - 1) * 100 : 0)} сценарий МЭР` : `по прогнозным ценам, ${fmtPct(m.base ? (m.fc / m.base - 1) * 100 : 0)}`} />
          <Kpi label={`Бюджет по рекомендуемой НМЦ ${year}`} value={fmtMoney(nmcSum)} note={reserve?.overall != null ? `потребность + надбавка закупщиков по категориям${m.partial ? "; часть позиций без количества не учтена" : ""}` : "надбавки прошлых лет нет — равен потребности"} />
        </div>
        {plan.length > 0 && (
          <div className="rounded-lg border px-4 py-3 text-xs" style={{ borderColor: RC.line, color: RC.ink2, ...NUM }}>
            <p className="font-semibold" style={{ color: RC.ink }}>Закупки из плана без договора — {plan.length} {plural(plan.length, "строка", "строки", "строк")} ГПЗ</p>
            <p className="mt-0.5">По ним нет заключённого договора, поэтому в расчёт цен они не входят, но в сумму ГПЗ включены по НМЦ из плана с ростом цен своего направления: {fmtMoney(planNmc)} → <b style={{ color: RC.ink }}>{fmtMoney(planNext)}</b>.</p>
            <p className="mt-1 font-semibold" style={{ color: RC.ink }}>Всего ГПЗ с ними: {fmtMoney(m.base + planNmc)} → {fmtMoney(m.fc + planNext)} ({fmtPct(m.base + planNmc ? ((m.fc + planNext) / (m.base + planNmc) - 1) * 100 : 0)})</p>
          </div>
        )}
        <p className="text-xs" style={{ color: RC.ink2 }}><b style={{ color: RC.ink }}>Допущение:</b> потребность {year} = объём закупок из ГПЗ {baseYear} × прогнозные цены. Если в ГПЗ {year} изменится состав или объём закупок, сумму нужно пересчитать — проценты роста по категориям при этом остаются ориентиром.</p>
        <div className="grid gap-3 lg:grid-cols-2">
          <Box title="Сумма по категориям">
            <table className="w-full text-xs" style={NUM}>
              <thead style={{ color: RC.muted }}><tr><th className={th}>Категория</th><th className={`${th} text-right`}>{baseYear}</th><th className={`${th} text-right`}>{year}</th><th className={`${th} text-right`}>Рост</th>{m.cons && <th className={`${th} text-right`}>Консерв.</th>}<th className={`${th} text-right`}>НМЦ {year}</th></tr></thead>
              <tbody>{m.cats.map((c) => (
                <tr key={c.key} style={{ borderColor: RC.line }}>
                  <td className={td} style={{ borderColor: RC.line }} title={c.key}>{shortCat(c.key)}</td>
                  <td className={`${td} text-right whitespace-nowrap`} style={{ borderColor: RC.line }}>{fmtMoney(c.base)}</td>
                  <td className={`${td} text-right whitespace-nowrap font-semibold`} style={{ borderColor: RC.line }}>{fmtMoney(c.fc)}</td>
                  <td className={`${td} text-right whitespace-nowrap`} style={{ borderColor: RC.line, color: RC.ink2 }}>{fmtPct(c.base ? (c.fc / c.base - 1) * 100 : 0)}</td>
                  {m.cons && <td className={`${td} text-right whitespace-nowrap`} style={{ borderColor: RC.line, color: RC.ink2 }}>{fmtMoney(c.cons)}</td>}
                  <td className={`${td} text-right whitespace-nowrap font-semibold`} style={{ borderColor: RC.line, color: RC.violet }} title={`надбавка ${fmtPct(resCat(c.key))}`}>{fmtMoney(c.fc * (1 + resCat(c.key) / 100))}</td>
                </tr>))}</tbody>
            </table>
          </Box>
          <Box title="Топ-10: больше всего прироста в рублях">
            <table className="w-full text-xs" style={NUM}>
              <thead style={{ color: RC.muted }}><tr><th className={th}>Позиция</th><th className={`${th} text-right`}>{year}</th><th className={`${th} text-right`}>Прирост</th></tr></thead>
              <tbody>{m.top.map(({ r, fc, d }, i) => (
                <tr key={i}>
                  <td className={td} style={{ borderColor: RC.line }}><span className="line-clamp-2" data-tip={`${r.subject} · ${r.regionName ?? ""} · ОКПД2 ${r.okpd2}`}>{r.gpzNames?.[0] ?? r.subject}</span>
                    <small style={{ color: RC.muted }}>{r.regionName ? shortRegion(r.regionName) : ""}</small></td>
                  <td className={`${td} text-right whitespace-nowrap`} style={{ borderColor: RC.line }}>{fmtMoney(fc)}</td>
                  <td className={`${td} text-right whitespace-nowrap font-semibold`} style={{ borderColor: RC.line }}>+{fmtMoney(d)}</td>
                </tr>))}</tbody>
            </table>
          </Box>
        </div>
      </>}
    </>
  );
  return (
    <>
    </>
  );
}

const PRICE_ROWS = 22;

type FactResp = { matched: number; accuracy: number | null; mape: number | null; rows: { subject: string; region: string | null; unit: string; forecast: number; actual: number; errorPct: number | null }[] };

/** Насколько прогноз совпал с фактом — лист появляется, только когда факт загружен */
function FactSheet({ forecastId }: { forecastId: number }) {
  const [fact, setFact] = useState<FactResp | null>(null);
  useEffect(() => {
    fetch(`/api/forecasts/${forecastId}/actuals`).then((r) => r.json()).then((j) => !j.error && setFact(j)).catch(() => null);
  }, [forecastId]);
  if (!fact?.matched) return null;
  const td = "border-t py-1.5 pr-3";
  return (
    <Sheet>
      <div>
        <h2 className="text-xl font-semibold">Насколько точен прогноз</h2>
        <p className="mt-0.5 text-sm" style={{ color: RC.ink2 }}>Сравнение прогноза с ценами договоров, заключённых в прогнозном году.</p>
      </div>
        <Box title="Точность по факту">
          {(
            <>
              <p className="text-2xl font-semibold" style={NUM}>{fact.accuracy != null ? `${fmtNum(fact.accuracy)} %` : "—"}</p>
              <p className="text-xs" style={{ color: RC.ink2 }}>точность по {fact.matched} {plural(fact.matched, "позиции", "позициям", "позициям")}; средняя ошибка {fact.mape != null ? `${fmtNum(fact.mape)} %` : "—"}. Самые большие расхождения:</p>
              <table className="mt-2 w-full text-xs" style={NUM}><tbody>{fact.rows.slice(0, 8).map((r, i) => (
                <tr key={i}><td className={td} style={{ borderColor: RC.line }}>{r.subject}<span className="block text-[10px]" style={{ color: RC.muted }}>{r.region ?? ""} · {r.unit}</span></td>
                  <td className={`${td} whitespace-nowrap text-right`} style={{ borderColor: RC.line }}>прогноз {rubShort(r.forecast)}</td>
                  <td className={`${td} whitespace-nowrap text-right`} style={{ borderColor: RC.line }}>факт {rubShort(r.actual)}</td>
                  <td className={`${td} whitespace-nowrap text-right font-semibold`} style={{ borderColor: RC.line }}>{r.errorPct != null ? fmtPct(r.errorPct) : "—"}</td></tr>
              ))}</tbody></table>
            </>
          )}
        </Box>
    </Sheet>
  );
}

/** Позиции, которые стоит проверить, и строки, не попавшие в расчёт — для сотрудников */
function AttentionSheet({ view, excluded, year, baseYear, reserve = null }: { view: ViewRow[]; excluded: ExcludedRow[]; year: number; baseYear: number; reserve?: Reserve | null }) {
  const list = view.filter((v) => v.reasons.length || v.meta?.edited)
    .sort((a, b) => (sumBase(b.row) ?? b.row.forecastPrice) - (sumBase(a.row) ?? a.row.forecastPrice)).slice(0, 18);
  const groups = new Map<string, number>();
  // Ошибки ОКАТО — одной группой: в тексте причины код и название региона, они у каждой строки свои
  const groupOf = (r: string) => (/ОКАТО/.test(r) ? "Ошибка кода ОКАТО (кода нет в справочнике или он не совпадает с регионом)" : reasonGroup(r));
  for (const e of excluded) groups.set(groupOf(e.reason), (groups.get(groupOf(e.reason)) ?? 0) + 1);
  const ex = [...groups.entries()].sort((a, b) => b[1] - a[1]);
  const okatoMap = new Map<string, number>();
  for (const e of excluded) if (/ОКАТО/.test(e.reason)) okatoMap.set(e.reason, (okatoMap.get(e.reason) ?? 0) + 1);
  const okato = [...okatoMap.entries()];
  const th = "py-1.5 pr-3 text-left text-[10.5px] font-medium uppercase tracking-wide";
  const td = "border-t py-1.5 pr-3 align-top";
  return (
    <>
      <div>
        <h2 className="text-xl font-semibold">Требуют внимания</h2>
        <p className="mt-0.5 text-sm" style={{ color: RC.ink2 }}>Позиции с замечаниями — самые крупные по сумме — и строки файлов, которые не попали в расчёт.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Box title={`Позиции с замечаниями (${view.filter((v) => v.reasons.length || v.meta?.edited).length})`}>
          <table className="w-full text-xs" style={NUM}>
            <thead style={{ color: RC.muted }}><tr><th className={th}>Позиция</th><th className={`${th} text-right`}>НМЦ {year}</th><th className={th}>Почему проверить</th></tr></thead>
            <tbody>{list.map((v) => (
              <tr key={v.id}><td className={td} style={{ borderColor: RC.line }}>{v.row.subject}<span className="block text-[10px]" style={{ color: RC.muted }}>{v.row.regionName ? shortRegion(v.row.regionName) : ""} · {v.row.unitLabel}</span></td>
                <td className={`${td} whitespace-nowrap text-right`} style={{ borderColor: RC.line }}>{(() => {
                  // Рекомендуемая НМЦ по позиции: сумма, если есть количество, иначе — за единицу
                  const k = 1 + (reserve?.overall == null ? 0 : reserve.byCat[v.row.category ?? ""] ?? reserve.overall) / 100;
                  const sum = sumForecast(v.row);
                  return sum != null ? fmtMoney(sum * k) : <>{rubShort(v.row.forecastPrice * k)}<span className="block text-[10px]" style={{ color: RC.muted }}>за {v.row.unitLabel}</span></>;
                })()}</td>
                <td className={td} style={{ borderColor: RC.line, color: RC.ink2 }}>{[...v.reasons.map((r) => REASON_SHORT[r]), ...(v.meta?.edited ? ["цена изменена вручную"] : [])].join("; ")}</td></tr>
            ))}</tbody>
          </table>
        </Box>
        <Box title={`Не попали в расчёт (${excluded.length})`}>
          {!ex.length ? <p className="text-xs" style={{ color: RC.muted }}>Все строки файлов вошли в расчёт.</p> : (
            <table className="w-full text-xs" style={NUM}><tbody>{ex.map(([k, n]) => (
              <tr key={k}><td className={td} style={{ borderColor: RC.line }}>{k}</td><td className={`${td} text-right font-semibold`} style={{ borderColor: RC.line }}>{n}</td></tr>
            ))}</tbody></table>
          )}
          {okato.length > 0 && (
            <div className="mt-2 text-[11px]" style={{ color: RC.ink2 }}>
              <p className="font-semibold" style={{ color: RC.ink }}>Какие коды ОКАТО не распознаны:</p>
              <ul className="list-disc pl-4">{okato.map(([r, n]) => <li key={r}>{r.replace(/^Код ОКАТО /, "")}{n > 1 ? ` — ${n} строк` : ""}</li>)}</ul>
              <p className="mt-1">Добавьте код в «Справочники → Регионы» или укажите в ГПЗ название региона — строки войдут в расчёт при повторной загрузке.</p>
            </div>
          )}
          {excluded.some((e) => e.plan) && <p className="mt-2 text-[11px]" style={{ color: RC.ink2 }}>Строки без договора с НМЦ в ГПЗ включены в сумму ГПЗ на листе «Итог».</p>}
          <p className="mt-2 text-[11px]" style={{ color: RC.muted }}>Список строк — на вкладке «Прогноз», ссылка «Посмотреть».</p>
        </Box>
      </div>
    </>
  );
}

const REASON_SHORT: Record<ReasonCode, string> = {
  cpi: "нет отраслевого индекса — по инфляции", no_index: "нет индекса", unapproved: "индекс не утверждён", not_december: "не пересчитана внутри года",
  repeat_unknown: "повторяемость не определена", few_contracts: "1–2 договора", vat_file: "НДС в файле не 22 %", later_year: "договор после базового года",
  long: "договор длиннее года", ds: "рост по допсоглашению", active: "договор действует весь год", months: "месяцы в ГПЗ ≠ сроку договора",
  lot: "цена за весь лот", okpd_short: "ОКПД2 неполный", negative_index: "индекс МЭР отрицательный — взята инфляция",
  okato_fixed: "ОКАТО неверный — регион по названию", apportioned: "договор поделён по годам",
};


const chunk = <T,>(xs: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };
/** Множитель к сумме: +6,3 % → «1,063» */
const fmtMult = (pct: number) => (1 + pct / 100).toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** Надёжность по числу договоров: меньше 5 — мало данных */
function reliability(contracts: number) {
  return contracts >= 10 ? { text: "надёжно", c: RC.teal } : contracts >= 5 ? { text: "средне", c: RC.ink2 } : { text: "мало данных", c: RC.warn };
}

/** Рост по группам для заказчика: полоса с линией инфляции, множитель к сумме и надёжность */
function RateTable({ groups, year, baseYear, cpi, examples, showReliability, reserve = null }: {
  groups: { key: string; label: string; total: number; rows: ForecastRow[] }[]; year: number; baseYear: number; cpi: number | null; examples?: boolean; showReliability?: boolean; reserve?: Reserve | null;
}) {
  // Надбавка группы — средняя по категориям её позиций; категории без истории — общая надбавка по ГПЗ
  const resOf = (rows: ForecastRow[]) => {
    if (!reserve || reserve.overall == null) return null;
    const xs = rows.map((r) => reserve.byCat[r.category ?? ""] ?? reserve.overall!);
    return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
  };
  const max = Math.max(cpi ?? 0, ...groups.map((g) => g.total), 1);
  const min = Math.min(0, ...groups.map((g) => g.total));
  const X = (v: number) => ((v - min) / (max - min || 1)) * 100;
  const th = "py-1.5 pr-3 text-left text-[10.5px] font-medium uppercase tracking-wide";
  const td = "border-t py-2 pr-3 align-middle";
  return (
    <table className="w-full text-xs" style={NUM}>
      <thead style={{ color: RC.muted }}><tr>
        <th className={th}>{examples ? "Направление" : "Категория"}</th><th className={`${th} w-[30%]`}>Рост цен по индексам</th>
        {reserve?.overall != null && <th className={`${th} text-right`}>Надбавка</th>}
        <th className={`${th} text-right`}>{reserve?.overall != null ? `Рекомендуемая НМЦ ${year}` : "Множитель к сумме"}</th>{showReliability && <th className={`${th} text-right`}>Надёжность</th>}
      </tr></thead>
      <tbody>{groups.map((g) => {
        const contracts = g.rows.reduce((s, r) => s + r.contracts, 0);
        const rel = reliability(contracts);
        const ex = [...new Set(g.rows.flatMap((r) => r.gpzNames ?? []))].slice(0, 2);
        return (
          <tr key={g.key}>
            <td className={td} style={{ borderColor: RC.line }}><span className="font-medium" style={{ color: RC.ink }}>{g.label || "Без категории"}</span>
              {examples && ex.length > 0 && <span className="block text-[10.5px]" style={{ color: RC.muted }}>например: {ex.join("; ")}</span>}</td>
            <td className={td} style={{ borderColor: RC.line }}>
              <div className="flex items-center gap-2">
                <div className="relative h-2.5 flex-1 rounded-sm" style={{ background: RC.track }}>
                  <div className="absolute inset-y-0 rounded-sm" style={{ left: `${X(Math.min(0, g.total))}%`, width: `${Math.abs(X(g.total) - X(0))}%`, background: g.total < 0 ? RC.sky : RC.blue }} />
                  {cpi != null && <div className="absolute -inset-y-1 border-l-2 border-dashed" style={{ left: `${X(cpi)}%`, borderColor: RC.navy }} title={`инфляция ${fmtNum(cpi)} %`} />}
                </div>
                <b className="w-14 text-right" style={{ color: RC.ink }}>{fmtPct(g.total)}</b>
              </div>
            </td>
            {(() => {
              const res = resOf(g.rows);
              if (res == null) return <td className={`${td} whitespace-nowrap text-right font-semibold`} style={{ borderColor: RC.line, color: RC.ink }}>× {fmtMult(g.total)}</td>;
              const n = nmcGrowth(g.total, res);
              return <>
                <td className={`${td} whitespace-nowrap text-right`} style={{ borderColor: RC.line, color: RC.ink2 }}>{fmtPct(res)}</td>
                <td className={`${td} whitespace-nowrap text-right`} style={{ borderColor: RC.line, color: RC.ink }}><b>{fmtPct(n)}</b><span className="block text-[10.5px]" style={{ color: RC.muted }}>× {fmtMult(n)} к договорам {baseYear}</span></td>
              </>;
            })()}
            {showReliability && <td className={`${td} whitespace-nowrap text-right`} style={{ borderColor: RC.line }}><span style={{ color: rel.c }}>{rel.text}</span>
              <span className="block text-[10px]" style={{ color: RC.muted }}>{contracts} {plural(contracts, "договор", "договора", "договоров")}</span></td>}
          </tr>
        );
      })}</tbody>
      {cpi != null && <caption className="caption-bottom pt-2 text-left text-[10.5px]" style={{ color: RC.muted }}>Пунктир — общая инфляция {fmtNum(cpi)} %: правее неё направление дорожает быстрее инфляции.{showReliability ? " «Мало данных» — меньше 5 договоров, сверьте с коммерческими предложениями." : ""}</caption>}
    </table>
  );
}



/** Лист отчёта: на экране — белая карточка, в PDF — отдельная страница */
function Sheet({ children }: { children: ReactNode }) {
  return <section data-pdf className="flex min-w-0 flex-col gap-5 rounded-xl bg-white p-4 shadow-sm ring-1 sm:p-8" style={{ ["--tw-ring-color" as string]: RC.line }}>{children}</section>;
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border bg-white px-4 py-4 sm:px-5" style={{ borderColor: RC.line }}>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Kpi({ label, value, note }: { label: string; value: ReactNode; note: string }) {
  return (
    <div className="min-w-0 rounded-xl border px-4 py-3" style={{ borderColor: RC.line }}>
      <p className="text-xs" style={{ color: RC.ink2 }}>{label}</p>
      <p className="my-0.5 text-2xl font-bold sm:text-[26px]" style={NUM}>{value}</p>
      <p className="line-clamp-2 text-[11.5px]" style={{ color: RC.muted }} data-tip={note}>{note}</p>
    </div>
  );
}







const tipOf = (name: string, g: Group, year: number, baseYear: number) =>
  `${name}: рост цен в ${baseYear} ${fmtPct(g.intra)} + рост в ${year} ${fmtPct(g.industry)} = ${fmtPct(g.total)}`;



const r1 = (v: number) => Math.round(v * 10) / 10;


/** Все предметы среза с регионами: регионы по возрастанию прогноза */
function regionTable(rows: ForecastRow[]) {
  // Сравниваем только одинаковые полные коды ОКПД2 с одной единицей; цена всего лота (1 ед.) не сравнивается
  const m = new Map<string, ForecastRow[]>();
  for (const r of rows) { if (r.lotPrice) continue; const k = `${r.okpd2}|${r.unitLabel}`; m.get(k)?.push(r) ?? m.set(k, [r]); }
  return [...m.values()].map((rs) => {
    // Несколько строк одного региона (разные коды WS) — среднее
    const byReg = new Map<string, ForecastRow[]>();
    for (const r of rs) { const k = r.regionName ?? r.region ?? "Регион не указан"; byReg.get(k)?.push(r) ?? byReg.set(k, [r]); }
    const regs = [...byReg.entries()].map(([name, g]) => ({
      name, base: g.reduce((s, r) => s + contractPrice(r), 0) / g.length, fc: g.reduce((s, r) => s + r.forecastPrice, 0) / g.length,
    })).sort((x, y) => x.fc - y.fc);
    return { subject: rs[0].gpzNames?.[0] && rs[0].subject.length < 4 ? rs[0].gpzNames[0] : rs[0].subject, okpd2: rs[0].okpd2, unit: rs[0].unitLabel, regs };
  });
}

const rubShort = (v: number) => (v >= 1e6 ? `${fmtNum(v / 1e6)} млн ₽` : `${Math.round(v).toLocaleString("ru-RU").replace(/\s/g, " ")} ₽`);


/** Три главные цифры: рост по индексам, надбавка закупщиков прошлых лет, рекомендуемая НМЦ */
function ThreeNumbers({ growth, reserve, year, baseYear, cpi, cpiSource }: { growth: number; reserve: Reserve | null; year: number; baseYear: number; cpi: number | null; cpiSource: string }) {
  const r = reserve?.overall ?? null;
  const n = r == null ? growth : nmcGrowth(growth, r);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Kpi label={`Рост цен по индексам на ${year}`} value={fmtPct(growth)} note={`к ценам договоров ${baseYear}: прогноз МЭР, Банка России, Росстата${cpi != null ? ` · инфляция ${fmtPct(cpi)} (${cpiSource})` : ""}`} />
      <Kpi label="Надбавка закупщиков" value={r == null ? "—" : fmtPct(r)} note={r == null ? "нет данных прошлых лет" : `на столько НМЦ в ГПЗ была выше договоров: ${reserveYearsText(reserve!)}`} />
      <div className="rounded-xl px-4 py-3 text-white" style={{ background: RC.violet }}>
        <p className="text-xs text-white/75">Рекомендуемая НМЦ на {year}</p>
        <p className="my-0.5 text-2xl font-bold sm:text-[26px]" style={NUM}>{fmtPct(n)}</p>
        <p className="text-[11.5px] text-white/75">{r == null ? "= рост по индексам" : `сначала ${fmtPct(growth)} рост, затем ${fmtPct(r)} надбавка к выросшей цене`}: умножьте сумму договора {baseYear} на {fmtMult(n)}</p>
      </div>
    </div>
  );
}
