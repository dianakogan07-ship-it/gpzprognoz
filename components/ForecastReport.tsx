"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconDownload } from "./Icons";
import { MultiSelect } from "./MultiSelect";
import type { ForecastFilters } from "./ForecastTable";
import { EMPTY_FILTERS, filterRows, reasonGroup, regionKey, type ReasonCode, type ViewRow } from "@/lib/forecastView";
import { lastDataMonth } from "@/lib/logic";
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
export function ForecastReport({ audience, view, filters, reference, year, baseYear, approved, approvedAt, title, forecastId, versionId, prevVersion, excluded }: {
  /** staff — внутренний отчёт: суммы ГПЗ и исходные данные расчёта; customer — для заказчиков, только проценты */
  audience: "staff" | "customer";
  view: ViewRow[]; filters: ForecastFilters; reference: Reference;
  year: number; baseYear: number; approved: boolean; approvedAt: string | null; title: string;
  forecastId: number; versionId: number; prevVersion: { id: number; number: number } | null; excluded: ExcludedRow[];
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
  const lastMonth = lastDataMonth(reference.indices, baseYear);
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
    const rateRows = (gs: { key: string; total: number; rows: ForecastRow[] }[], ex: boolean) => gs.map((g) => {
      const n = g.rows.reduce((s, r) => s + r.contracts, 0);
      return [g.key || "Без категории", ...(ex ? [[...new Set(g.rows.flatMap((r) => r.gpzNames ?? []))].slice(0, 3).join("; ")] : []), p1(g.total), m3(g.total), n, reliability(n).text];
    });
    if (audience === "customer") {
      const headC = [[`Прогноз цен ${year} — ${title}`], [`Срез: ${sliceText}. Рост к ценам договоров ${baseYear}, базовый сценарий МЭР${approved ? "" : ". Прогноз не утверждён"}`], []];
      add("Сводка", [...headC,
        ["Показатель", "Значение"],
        [`Средний рост цен в ${year}, %`, p1(total.total)],
        [`Множитель к сумме закупки ${baseYear}`, m3(total.total)],
        ...(cpi != null ? [[`Общая инфляция, прогноз ${cpiSource}, %`, p1(cpi)]] : []),
        [],
        ["Как применить: сумма закупки " + baseYear + " × множитель = ориентир на " + year + ". Проценты одинаковы для сумм с НДС и без НДС."],
      ], [60, 14]);
      add("Рост по категориям", [...headC, ["Категория", "Рост, %", "Множитель", "Договоров", "Надёжность"], ...rateRows(cats, false)], [48, 10, 12, 12, 14]);
      add("Рост по направлениям", [...headC, ["Направление", "Примеры закупок", "Рост, %", "Множитель", "Договоров", "Надёжность"], ...rateRows(subjects, true)], [50, 60, 10, 12, 12, 14]);
      add("Источники", [["Источник", "Ссылка"], ...sources.map((x) => [x.name, x.url])], [70, 70]);
      const { downloadWorkbook } = await import("@/lib/excel");
      const regs = f.region.map((k) => counts.reg.get(k)?.label ?? k);
      downloadWorkbook(wb, `Прогноз цен ${year} — ${title}${regs.length && regs.length <= 3 ? ` — ${regs.join(", ")}` : ""}${approved ? "" : " (не утверждён)"}.xlsx`.replace(/[\\/:*?"<>|]+/g, " "));
      return;
    }
    const head = [[`Прогноз цен ${year} — ${title}`], [`Срез: ${sliceText}. Расчёт по базовому сценарию МЭР${approved ? "" : ". Прогноз не утверждён"}`], []];
    add("Сводка", [...head,
      ["Показатель", "Значение", "Ед."],
      [`Средний рост цен в ${year}`, p1(total.total), "%"],
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
    add("Рост по направлениям", [...head, ["Направление", "Примеры закупок", "Рост, %", "Множитель", "Договоров", "Надёжность"], ...rateRows(subjects, true)], [50, 60, 10, 12, 12, 14]);
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
    add("Надёжность", [...head, [money.byWeight ? "Источник цены (доля суммы)" : "Источник цены (доля позиций)", "%"], ...money.trust.map((t) => [t.label, p1(t.v)])], [50, 10]);
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
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <div className="rounded-xl px-4 py-3 text-white" style={{ background: RC.violet }}>
                  <p className="text-xs text-white/75">Средний рост цен в {year}</p>
                  <p className="my-0.5 text-2xl font-bold sm:text-[26px]" style={NUM}>{fmtPct(total.total)}</p>
                  <p className="text-[11.5px] text-white/75">умножьте сумму {baseYear} на {fmtMult(total.total)}</p>
                </div>
                <Kpi label="Общая инфляция" value={cpi != null ? fmtPct(cpi) : "—"} note={cpi != null ? `прогноз ${cpiSource} на ${year}` : "прогноза нет"} />
                {cpi != null && <Kpi label="Дороже инфляции" value={<>{above} <small className="text-sm font-medium" style={{ color: RC.ink2 }}>из {subjects.length}</small></>} note="направлений растут быстрее инфляции" />}
              </div>
              <div className="rounded-lg px-4 py-3 text-xs leading-relaxed" style={{ background: RC.bg, color: RC.ink2 }}>
                <p className="font-semibold" style={{ color: RC.ink }}>Как применить</p>
                <p className="mt-0.5">Найдите своё направление ниже и умножьте сумму закупки {baseYear} года на множитель. Например, закупка на 10 млн ₽ при росте {fmtPct(total.total)} — в {year} году ≈ {fmtMoney(10_000_000 * (1 + total.total / 100))}. Проценты одинаковы для сумм с НДС и без НДС. Договор на несколько лет — на каждый следующий год добавьте рост цен по прогнозу инфляции.</p>
              </div>
              {cats.length > 0 && <Box title="Рост цен по категориям закупок"><RateTable year={year} baseYear={baseYear} cpi={cpi} groups={cats.map((c) => ({ key: c.key, label: shortCat(c.key), total: c.total, rows: c.rows }))} /></Box>}
            </Sheet>
            {chunk(subjects, 16).map((part, i, all) => (
              <Sheet key={i}>
                <div>
                  <h2 className="text-xl font-semibold">Рост цен по направлениям закупок{all.length > 1 ? ` · ${i + 1} из ${all.length}` : ""}</h2>
                  <p className="mt-0.5 text-sm" style={{ color: RC.ink2 }}>Направление — вид товаров и услуг. Под названием — примеры закупок из плана. Сверху — направления с самым большим ростом.</p>
                </div>
                <RateTable year={year} baseYear={baseYear} cpi={cpi} examples groups={part.map((g) => ({ key: g.key, label: g.key, total: g.total, rows: g.rows }))} />
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
              <MoneySheet part="summary" view={slice} year={year} baseYear={baseYear} shortCat={shortCat} growth={total.total} cpi={cpi} cpiSource={cpiSource} />
            </Sheet>
            <Sheet>
              <InputsSheet view={slice} reference={reference} year={year} baseYear={baseYear} />
              <Box title="Из чего складывается рост"><Waterfall split={total} year={year} baseYear={baseYear} lastMonth={lastMonth} /></Box>
              <MoneySheet part="basis" view={slice} year={year} baseYear={baseYear} shortCat={shortCat} growth={total.total} cpi={cpi} cpiSource={cpiSource} />
            </Sheet>
            <Sheet><AttentionSheet view={slice} excluded={excluded} year={year} baseYear={baseYear} /></Sheet>
            <Sheet><ChangesSheet forecastId={forecastId} curVersionId={versionId} prevVersionId={prevVersion?.id ?? null} prevNumber={prevVersion?.number ?? null} /></Sheet>
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

/** Замечания к исходным договорам — общие для листов сотрудника */
function dataNotes(view: ViewRow[], year: number, baseYear: number) {
  const m = moneyData(view);
  return [
    ...m.ds.map((d) => `${d.key || "Без категории"}: ${d.n} ${plural(d.n, "договор увеличен", "договора увеличены", "договоров увеличены")} допсоглашениями в среднем на ${fmtNum(d.avg)} % к предложению победителя — цена за единицу может быть завышена`),
    m.active ? `${m.active} ${plural(m.active, "договор действует", "договора действуют", "договоров действуют")} весь ${year} год — по ним закупка может не понадобиться` : "",
    m.long ? `${m.long} ${plural(m.long, "договор", "договора", "договоров")} длиннее года: цена отнесена к середине срока; в новой закупке на несколько лет учтите рост цен следующих лет` : "",
    m.later ? `${m.later} ${plural(m.later, "договор заключён", "договора заключены", "договоров заключены")} после ${baseYear} года — без пересчёта внутри года` : "",
    m.lots ? `${m.lots} ${plural(m.lots, "позиция", "позиции", "позиций")} с ценой за весь лот (количество 1)` : "",
  ].filter(Boolean);
}

/**
 * Деньги для сотрудника. summary — сумма ГПЗ и потребность по категориям, топ-10, кварталы;
 * basis — надёжность расчёта и НМЦ
 */
function MoneySheet({ part, view, year, baseYear, shortCat, growth, cpi, cpiSource }: {
  part: "summary" | "basis"; view: ViewRow[]; year: number; baseYear: number; shortCat: (n: string) => string; growth: number; cpi: number | null; cpiSource: string;
}) {
  const m = moneyData(view);
  const th = "py-1.5 pr-3 text-left text-[11px] font-medium uppercase tracking-wide";
  const td = "border-t py-1.5 pr-3";
  const qMax = Math.max(1, ...m.quarters);

  if (part === "summary") return (
    <>
      {!m.hasSums ? <p className="text-sm" style={{ color: RC.muted }}>В этой версии не сохранено количество — суммы появятся после повторной загрузки файлов ГПЗ и отчётности. Средний рост цен: {fmtPct(growth)}.</p> : <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl px-4 py-3 text-white" style={{ background: RC.violet }}>
            <p className="text-xs text-white/75">Рост цен в {year}</p>
            <p className="my-0.5 text-2xl font-bold" style={NUM}>{fmtPct(growth)}</p>
            <p className="text-[11.5px] text-white/75">{cpi != null ? `инфляция, прогноз ${cpiSource}: ${fmtPct(cpi)}` : "прогноза инфляции нет"}</p>
          </div>
          <Kpi label={`Сумма ГПЗ ${baseYear}`} value={fmtMoney(m.base)} note="по ценам договоров, без НДС" />
          <Kpi label={`Потребность ${year}`} value={m.cons ? <>{fmtMoney(m.fc)} <small className="text-sm font-medium" style={{ color: RC.ink2 }}>– {fmtMoney(m.fcCons)}</small></> : fmtMoney(m.fc)}
            note={m.cons ? `базовый ${fmtPct(m.base ? (m.fc / m.base - 1) * 100 : 0)} – консервативный ${fmtPct(m.base ? (m.fcCons / m.base - 1) * 100 : 0)} сценарий МЭР` : `по прогнозным ценам, ${fmtPct(m.base ? (m.fc / m.base - 1) * 100 : 0)}`} />
          <Kpi label="Прирост" value={fmtMoney(m.fc - m.base)} note={m.partial ? "часть позиций без количества не учтена" : "при том же объёме закупок"} />
        </div>
        <p className="text-xs" style={{ color: RC.ink2 }}><b style={{ color: RC.ink }}>Допущение:</b> потребность {year} = объём закупок из ГПЗ {baseYear} × прогнозные цены. Если в ГПЗ {year} изменится состав или объём закупок, сумму нужно пересчитать — проценты роста по категориям при этом остаются ориентиром.</p>
        <div className="grid gap-3 lg:grid-cols-2">
          <Box title="Сумма по категориям">
            <table className="w-full text-xs" style={NUM}>
              <thead style={{ color: RC.muted }}><tr><th className={th}>Категория</th><th className={`${th} text-right`}>{baseYear}</th><th className={`${th} text-right`}>{year}</th><th className={`${th} text-right`}>Рост</th>{m.cons && <th className={`${th} text-right`}>Консерв.</th>}</tr></thead>
              <tbody>{m.cats.map((c) => (
                <tr key={c.key} style={{ borderColor: RC.line }}>
                  <td className={td} style={{ borderColor: RC.line }} title={c.key}>{shortCat(c.key)}</td>
                  <td className={`${td} text-right whitespace-nowrap`} style={{ borderColor: RC.line }}>{fmtMoney(c.base)}</td>
                  <td className={`${td} text-right whitespace-nowrap font-semibold`} style={{ borderColor: RC.line }}>{fmtMoney(c.fc)}</td>
                  <td className={`${td} text-right whitespace-nowrap`} style={{ borderColor: RC.line, color: RC.ink2 }}>{fmtPct(c.base ? (c.fc / c.base - 1) * 100 : 0)}</td>
                  {m.cons && <td className={`${td} text-right whitespace-nowrap`} style={{ borderColor: RC.line, color: RC.ink2 }}>{fmtMoney(c.cons)}</td>}
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
      {m.quarters.some(Boolean) && (
        <Box title={`Потребность ${year} по кварталам (по графику ГПЗ ${baseYear})`}>
          <div className="flex h-28 items-end gap-3">
            {m.quarters.map((n, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1 text-xs" style={NUM}>
                <b>{m.quarterSums[i] ? fmtMoney(m.quarterSums[i]) : n}</b>
                <div className="w-full rounded-t" style={{ height: `${((m.quarterSums.some(Boolean) ? m.quarterSums[i] / Math.max(...m.quarterSums) : n / qMax)) * 70}px`, background: RC.blue }} />
                <span style={{ color: RC.muted }}>{i + 1} кв. · {n} {plural(n, "закупка", "закупки", "закупок")}</span>
              </div>
            ))}
          </div>
        </Box>
      )}
    </>
  );
  return (
    <>
      <div className="grid gap-3">
        <Box title={`Надёжность расчёта${m.byWeight ? " — доля суммы" : " — доля позиций"}`}>
          <div className="flex h-4 overflow-hidden rounded" style={{ background: RC.track }}>
            {m.trust.filter((t) => t.v > 0).map((t) => <div key={t.label} style={{ width: `${t.v}%`, background: t.c }} data-tip={`${t.label}: ${fmtNum(t.v)} %`} />)}
          </div>
          <ul className="mt-3 space-y-1 text-xs" style={{ color: RC.ink2 }}>
            {m.trust.map((t) => <li key={t.label} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: t.c }} /><span className="flex-1">{t.label}</span><b style={{ ...NUM, color: RC.ink }}>{fmtNum(t.v)} %</b></li>)}
          </ul>
        </Box>
      </div>
      {m.nmc && (
        <Box title="НМЦ и экономия на торгах">
          <div className="grid gap-3 text-xs sm:grid-cols-3" style={NUM}>
            <div><p style={{ color: RC.muted }}>НМЦ {baseYear}</p><p className="text-lg font-semibold">{fmtMoney(m.nmc.nmc)}</p></div>
            <div><p style={{ color: RC.muted }}>Договоры {baseYear} — экономия на торгах</p><p className="text-lg font-semibold">{fmtMoney(m.nmc.contract)} <small className="text-sm font-medium" style={{ color: RC.ink2 }}>{fmtPct((m.nmc.contract / m.nmc.nmc - 1) * 100)}</small></p></div>
            <div><p style={{ color: RC.muted }}>НМЦ {year} — от НМЦ {baseYear} с ростом цен</p><p className="text-lg font-semibold">{fmtMoney(m.nmc.nmcNext)}</p></div>
          </div>
          <p className="mt-2 text-xs" style={{ color: RC.ink2 }}>Цена договора — это цена после торгов. Если ставить НМЦ {year} от цены договора, в ней не будет запаса на торг; вариант «от НМЦ {baseYear}» сохраняет его. По {m.nmc.positions} {plural(m.nmc.positions, "позиции", "позициям", "позициям")}, где в отчётности есть НМЦ.</p>
        </Box>
      )}
    </>
  );
}

const PRICE_ROWS = 22;

type CompareResp = { rows: { subject: string; region: string | null; unit: string; a: number | null; b: number | null; deltaPct: number | null }[]; total: { common: number; changed: number; onlyA: number; onlyB: number; growth: number | null } };
type FactResp = { matched: number; accuracy: number | null; mape: number | null; rows: { subject: string; region: string | null; unit: string; forecast: number; actual: number; errorPct: number | null }[] };

/** Что изменилось к прошлой версии и насколько прогноз совпал с фактом — для сотрудников */
function ChangesSheet({ forecastId, prevVersionId, curVersionId, prevNumber }: { forecastId: number; prevVersionId: number | null; curVersionId: number; prevNumber: number | null }) {
  const [cmp, setCmp] = useState<CompareResp | null>(null);
  const [fact, setFact] = useState<FactResp | null>(null);
  useEffect(() => {
    if (prevVersionId) fetch(`/api/forecasts/compare?a=${prevVersionId}&b=${curVersionId}&changed=1`).then((r) => r.json()).then((j) => !j.error && setCmp(j)).catch(() => null);
    fetch(`/api/forecasts/${forecastId}/actuals`).then((r) => r.json()).then((j) => !j.error && setFact(j)).catch(() => null);
  }, [forecastId, prevVersionId, curVersionId]);
  const th = "py-1.5 pr-3 text-left text-[10.5px] font-medium uppercase tracking-wide";
  const td = "border-t py-1.5 pr-3";
  return (
    <>
      <div>
        <h2 className="text-xl font-semibold">Что изменилось и насколько точен прогноз</h2>
        <p className="mt-0.5 text-sm" style={{ color: RC.ink2 }}>Сравнение с прошлой версией прогноза и с фактическими ценами, если факт загружен.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Box title={prevNumber ? `К версии ${prevNumber}` : "К прошлой версии"}>
          {!prevVersionId ? <p className="text-xs" style={{ color: RC.muted }}>Это первая версия прогноза — сравнивать не с чем.</p> : !cmp ? <p className="text-xs" style={{ color: RC.muted }}>Загрузка…</p> : (
            <>
              <p className="text-xs" style={{ color: RC.ink2 }}>Изменились {cmp.total.changed} из {cmp.total.common} позиций{cmp.total.onlyB ? `, новых — ${cmp.total.onlyB}` : ""}{cmp.total.onlyA ? `, выбыло — ${cmp.total.onlyA}` : ""}.{cmp.total.growth != null ? ` Прогнозные цены по общим позициям: ${fmtPct(cmp.total.growth)} к прошлой версии.` : ""}</p>
              {cmp.total.changed > 0 && <table className="mt-2 w-full text-xs" style={NUM}>
                <thead style={{ color: RC.muted }}><tr><th className={th}>Позиция</th><th className={`${th} text-right`}>Было</th><th className={`${th} text-right`}>Стало</th><th className={`${th} text-right`}>Изм.</th></tr></thead>
                <tbody>{cmp.rows.filter((r) => r.a != null && r.b != null).slice(0, 12).map((r, i) => (
                  <tr key={i}><td className={td} style={{ borderColor: RC.line }}>{r.subject}<span className="block text-[10px]" style={{ color: RC.muted }}>{r.region ?? ""} · {r.unit}</span></td>
                    <td className={`${td} whitespace-nowrap text-right`} style={{ borderColor: RC.line }}>{rubShort(r.a!)}</td>
                    <td className={`${td} whitespace-nowrap text-right font-semibold`} style={{ borderColor: RC.line }}>{rubShort(r.b!)}</td>
                    <td className={`${td} whitespace-nowrap text-right`} style={{ borderColor: RC.line }}>{r.deltaPct != null ? fmtPct(r.deltaPct) : "—"}</td></tr>
                ))}</tbody>
              </table>}
            </>
          )}
        </Box>
        <Box title="Точность по факту">
          {!fact || !fact.matched ? <p className="text-xs" style={{ color: RC.muted }}>Факт ещё не загружен. Когда в прогнозном году появятся договоры, загрузите их в меню «⋯» прогноза — здесь появится, насколько прогноз совпал с реальными ценами.</p> : (
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
      </div>
    </>
  );
}

/** Позиции, которые стоит проверить, и строки, не попавшие в расчёт — для сотрудников */
function AttentionSheet({ view, excluded, year, baseYear }: { view: ViewRow[]; excluded: ExcludedRow[]; year: number; baseYear: number }) {
  const notes = dataNotes(view, year, baseYear);
  const list = view.filter((v) => v.reasons.length || v.meta?.edited)
    .sort((a, b) => (sumBase(b.row) ?? b.row.forecastPrice) - (sumBase(a.row) ?? a.row.forecastPrice)).slice(0, 18);
  const groups = new Map<string, number>();
  // Ошибки ОКАТО — одной группой: в тексте причины код и название региона, они у каждой строки свои
  const groupOf = (r: string) => (/ОКАТО/.test(r) ? "Ошибка кода ОКАТО (кода нет в справочнике или он не совпадает с регионом)" : reasonGroup(r));
  for (const e of excluded) groups.set(groupOf(e.reason), (groups.get(groupOf(e.reason)) ?? 0) + 1);
  const ex = [...groups.entries()].sort((a, b) => b[1] - a[1]);
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
            <thead style={{ color: RC.muted }}><tr><th className={th}>Позиция</th><th className={`${th} text-right`}>Прогноз</th><th className={th}>Почему проверить</th></tr></thead>
            <tbody>{list.map((v) => (
              <tr key={v.id}><td className={td} style={{ borderColor: RC.line }}>{v.row.subject}<span className="block text-[10px]" style={{ color: RC.muted }}>{v.row.regionName ? shortRegion(v.row.regionName) : ""} · {v.row.unitLabel}</span></td>
                <td className={`${td} whitespace-nowrap text-right`} style={{ borderColor: RC.line }}>{rubShort(v.row.forecastPrice)}</td>
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
          <p className="mt-2 text-[11px]" style={{ color: RC.muted }}>Список строк — на вкладке «Прогноз», ссылка «Посмотреть».</p>
        </Box>
      </div>
      {notes.length > 0 && (
        <div className="rounded-lg border px-4 py-3 text-xs" style={{ borderColor: RC.line, color: RC.ink2 }}>
          <p className="mb-1 font-semibold" style={{ color: RC.ink }}>Особенности договоров</p>
          <ul className="list-disc space-y-0.5 pl-4">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      )}
    </>
  );
}

const REASON_SHORT: Record<ReasonCode, string> = {
  cpi: "нет отраслевого индекса — по инфляции", no_index: "нет индекса", unapproved: "индекс не утверждён", not_december: "не пересчитана внутри года",
  repeat_unknown: "повторяемость не определена", few_contracts: "1–2 договора", vat_file: "НДС в файле не 22 %", later_year: "договор после базового года",
  long: "договор длиннее года", ds: "рост по допсоглашению", active: "договор действует весь год", months: "месяцы в ГПЗ ≠ сроку договора",
  lot: "цена за весь лот", okpd_short: "ОКПД2 неполный",
};


const chunk = <T,>(xs: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };
/** Множитель к сумме: +6,3 % → «1,063» */
const fmtMult = (pct: number) => (1 + pct / 100).toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** Надёжность по числу договоров: меньше 5 — мало данных */
function reliability(contracts: number) {
  return contracts >= 10 ? { text: "надёжно", c: RC.teal } : contracts >= 5 ? { text: "средне", c: RC.ink2 } : { text: "мало данных", c: RC.warn };
}

/** Рост по группам для заказчика: полоса с линией инфляции, множитель к сумме и надёжность */
function RateTable({ groups, year, baseYear, cpi, examples }: {
  groups: { key: string; label: string; total: number; rows: ForecastRow[] }[]; year: number; baseYear: number; cpi: number | null; examples?: boolean;
}) {
  const max = Math.max(cpi ?? 0, ...groups.map((g) => g.total), 1);
  const min = Math.min(0, ...groups.map((g) => g.total));
  const X = (v: number) => ((v - min) / (max - min || 1)) * 100;
  const th = "py-1.5 pr-3 text-left text-[10.5px] font-medium uppercase tracking-wide";
  const td = "border-t py-2 pr-3 align-middle";
  return (
    <table className="w-full text-xs" style={NUM}>
      <thead style={{ color: RC.muted }}><tr>
        <th className={th}>{examples ? "Направление" : "Категория"}</th><th className={`${th} w-[34%]`}>Рост цен {year} к {baseYear}</th>
        <th className={`${th} text-right`}>Множитель к сумме</th><th className={`${th} text-right`}>Надёжность</th>
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
            <td className={`${td} whitespace-nowrap text-right font-semibold`} style={{ borderColor: RC.line, color: RC.ink }}>× {fmtMult(g.total)}</td>
            <td className={`${td} whitespace-nowrap text-right`} style={{ borderColor: RC.line }}><span style={{ color: rel.c }}>{rel.text}</span>
              <span className="block text-[10px]" style={{ color: RC.muted }}>{contracts} {plural(contracts, "договор", "договора", "договоров")}</span></td>
          </tr>
        );
      })}</tbody>
      {cpi != null && <caption className="caption-bottom pt-2 text-left text-[10.5px]" style={{ color: RC.muted }}>Пунктир — общая инфляция {fmtNum(cpi)} %: правее неё направление дорожает быстрее инфляции. «Мало данных» — меньше 5 договоров, сверьте с коммерческими предложениями.</caption>}
    </table>
  );
}


/** Исходные данные расчёта — для сотрудников: какие индексы и с какими значениями применены, качество данных */
function InputsSheet({ view, reference, year, baseYear }: { view: ViewRow[]; reference: Reference; year: number; baseYear: number }) {
  const act = reference.indices.filter(isActiveIndex);
  const one = (kind: string, key: string | null = null) => act.find((i) => i.kind === kind && i.year === year && (i.key ?? null) === key) ?? null;
  const src = (code: string | null) => (code ? reference.sources.find((x) => x.code === code)?.name.split(/\s+[—-]\s+/)[0] ?? code : "—");
  const date = (i: { loaded_at?: string | null } | null) => (i?.loaded_at ? new Date(i.loaded_at).toLocaleDateString("ru-RU") : "—");
  const lastMonth = lastDataMonth(reference.indices, baseYear);
  const macro: [string, PriceIndex | null, PriceIndex | null][] = [
    ["Общая инфляция (ИПЦ)", one("cpi"), one("cpi_cons")],
    ["Рост зарплат — охрана, уборка, питание, обучение", one("wage"), one("wage_cons")],
    ["Курс доллара — валютные договоры", one("fx", "USD"), one("fx_cons", "USD")],
  ];
  const rows = view.map((v) => v.row);
  // Какие индексы фактически применены и к скольким позициям
  const used = new Map<string, { label: string; value: number; cons: number; n: number; contracts: number }>();
  const LEVEL: Record<string, string> = { okpd2: "ОКПД2", okved2: "раздел ОКВЭД2", cpi: "инфляция", wage: "зарплаты", fx: "курс", minstroy: "Минстрой" };
  for (const r of rows) {
    const k = `${r.indexLevel}|${r.indexKey ?? ""}`;
    const label = r.indexLevel === "minstroy" ? `Минстрой: ${r.regionName ?? r.region ?? ""}` : `${LEVEL[r.indexLevel]}${r.indexKey ? ` ${r.indexKey}` : ""}${r.indexName ? ` — ${r.indexName}` : ""}`;
    const e = used.get(k) ?? { label, value: r.forecastIndex, cons: r.forecastIndexCons ?? r.forecastIndex, n: 0, contracts: 0 };
    e.n++; e.contracts += r.contracts; used.set(k, e);
  }
  const usedList = [...used.values()].sort((a, b) => b.n - a.n);
  const q = (pred: (r: ForecastRow) => number) => rows.reduce((s, r) => s + pred(r), 0);
  const quality: [string, number][] = [
    ["Позиций в прогнозе", rows.length],
    ["Договоров в основе", q((r) => r.contracts)],
    ["Позиций на общей инфляции (нет отраслевого индекса)", rows.filter((r) => r.indexLevel === "cpi").length],
    ["Позиций с 1–2 договорами (цена может быть случайной)", rows.filter((r) => r.contracts < 3).length],
    ["Договоров, увеличенных допсоглашениями", q((r) => r.dsUp?.length ?? 0)],
    ["Договоров длиннее года", q((r) => r.longContracts ?? 0)],
    ["Договоров, действующих весь " + year + " год", q((r) => r.activeTarget ?? 0)],
    ["Договоров, заключённых после " + baseYear + " года", q((r) => r.laterYear ?? 0)],
    ["Позиций с ценой за весь лот", rows.filter((r) => r.lotPrice).length],
    ["Позиций со ставкой НДС в файле не 22 % (применена 22 %)", rows.filter((r) => r.vatFile != null).length],
    ["Позиций с ручной правкой цены", view.filter((v) => v.meta?.edited).length],
  ];
  const th = "py-1.5 pr-3 text-left text-[11px] font-medium uppercase tracking-wide";
  const td = "border-t py-1.5 pr-3";
  return (
    <>
      <div>
        <h2 className="text-xl font-semibold">Исходные данные расчёта</h2>
        <p className="mt-0.5 text-sm" style={{ color: RC.ink2 }}>На каких цифрах построен прогноз {year}: показатели Минэкономразвития, индексы по отраслям, пересчёт Росстата и качество исходных данных.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Box title="Макропоказатели на прогнозный год">
          <table className="w-full text-xs" style={NUM}>
            <thead style={{ color: RC.muted }}><tr><th className={th}>Показатель</th><th className={`${th} text-right`}>Базовый</th><th className={`${th} text-right`}>Консерв.</th><th className={th}>Источник, загружен</th></tr></thead>
            <tbody>
              {macro.map(([l, b, c]) => (
                <tr key={l}><td className={td} style={{ borderColor: RC.line }}>{l}</td>
                  <td className={`${td} whitespace-nowrap text-right font-semibold`} style={{ borderColor: RC.line }}>{b ? fmtPct((b.value - 1) * 100) : "нет"}</td>
                  <td className={`${td} whitespace-nowrap text-right`} style={{ borderColor: RC.line }}>{c ? fmtPct((c.value - 1) * 100) : "—"}</td>
                  <td className={td} style={{ borderColor: RC.line, color: RC.ink2 }}>{b ? `${src(b.source_code)}, ${date(b)}${b.approved ? "" : " · не утверждён"}` : "не загружен"}</td></tr>
              ))}
              <tr><td className={td} style={{ borderColor: RC.line }}>Пересчёт внутри {baseYear} года (Росстат)</td>
                <td colSpan={3} className={td} style={{ borderColor: RC.line, color: RC.ink2 }}>{lastMonth ? `цены договоров доведены до уровня: ${MONTHS[lastMonth - 1]} ${baseYear}` : "индексы не загружены — шаг пропущен"}</td></tr>
              <tr><td className={td} style={{ borderColor: RC.line }}>НДС</td>
                <td colSpan={3} className={td} style={{ borderColor: RC.line, color: RC.ink2 }}>22 % по умолчанию; другие ставки — только подтверждённые при загрузке</td></tr>
            </tbody>
          </table>
        </Box>
        <Box title="Качество исходных данных">
          <table className="w-full text-xs" style={NUM}><tbody>
            {quality.map(([l, n]) => (
              <tr key={l}><td className={td} style={{ borderColor: RC.line }}>{l}</td><td className={`${td} text-right font-semibold`} style={{ borderColor: RC.line, color: n && !/^(Позиций в|Договоров в основе)/.test(l) ? RC.warn : RC.ink }}>{n.toLocaleString("ru-RU")}</td></tr>
            ))}
          </tbody></table>
        </Box>
      </div>
      <Box title="Какие индексы применены">
        <table className="w-full text-xs" style={NUM}>
          <thead style={{ color: RC.muted }}><tr><th className={th}>Индекс</th><th className={`${th} text-right`}>Рост {year}</th><th className={`${th} text-right`}>Консерв.</th><th className={`${th} text-right`}>Позиций</th><th className={`${th} text-right`}>Договоров</th></tr></thead>
          <tbody>{usedList.map((u) => (
            <tr key={u.label}><td className={td} style={{ borderColor: RC.line }}>{u.label}</td>
              <td className={`${td} text-right font-semibold`} style={{ borderColor: RC.line }}>{fmtPct((u.value - 1) * 100)}</td>
              <td className={`${td} text-right`} style={{ borderColor: RC.line }}>{fmtPct((u.cons - 1) * 100)}</td>
              <td className={`${td} text-right`} style={{ borderColor: RC.line }}>{u.n}</td>
              <td className={`${td} text-right`} style={{ borderColor: RC.line }}>{u.contracts}</td></tr>
          ))}</tbody>
        </table>
      </Box>
    </>
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



/** Водопад: цена договоров → рост внутри базового года → рост отрасли → прогноз. Ось обрезана снизу — показан разрыв */
function Waterfall({ split, year, baseYear, lastMonth }: { split: { total: number; intra: number; industry: number }; year: number; baseYear: number; lastMonth: number | null }) {
  const lo = Math.min(100, 100 + split.intra, 100 + split.total);
  const hi = Math.max(100, 100 + split.intra, 100 + split.total);
  const floor = Math.max(0, Math.floor(lo - Math.max(hi - lo, 2) * 1.2));
  const h = (v: number) => ((v - floor) / (hi - floor || 1)) * 100;
  const rate = ((100 + split.total) / (100 + split.intra) - 1) * 100;
  const bars = [
    { from: floor, to: 100, color: RC.navy, label: "100 %", brk: true, tip: `Медианная цена договоров ${baseYear} без НДС принята за 100 %` },
    { from: 100, to: 100 + split.intra, color: RC.sky, label: fmtPct(split.intra), tip: `Пересчёт цены договора до последнего месяца с данными Росстата: ${fmtPct(split.intra)}` },
    // Рост отрасли начисляется на уже выросшую цену: подпись — сам рост отрасли, высота столбика — его вклад в п.п. от цены договора
    { from: 100 + split.intra, to: 100 + split.total, color: RC.blue, label: fmtPct(rate), tip: `Рост цен в ${year} (отраслевые индексы, зарплаты, курс, Минстрой): ${fmtPct(rate)} к уже выросшей цене (${fmtNum(split.industry)} п.п. от цены договора). Итого: (1 ${split.intra < 0 ? "−" : "+"} ${fmtNum(Math.abs(split.intra), 2)} %) × (1 ${rate < 0 ? "−" : "+"} ${fmtNum(Math.abs(rate), 2)} %) − 1 = ${fmtPct(split.total)}` },
    { from: floor, to: 100 + split.total, color: RC.violet, label: `${fmtNum(100 + split.total)} %`, brk: true, tip: `Прогноз цены ${year} к цене договоров ${baseYear}` },
  ];
  const caps: [string, string][] = [
    [`Цена договоров ${baseYear}`, "медиана, без НДС"],
    [`Рост цен в ${baseYear}`, `Росстат${lastMonth ? `, до ${MONTHS_GEN[lastMonth - 1]}` : ""}`],
    [`Рост в ${year}`, "МЭР, Минстрой"],
    [`Прогноз ${year}`, `к цене договоров ${baseYear}`],
  ];
  return (
    <div>
      <div className="mt-8 grid h-56 grid-cols-4 gap-2.5 border-b sm:h-[250px]" style={{ borderColor: RC.line }}>
        {bars.map((b, i) => {
          const bottom = h(Math.min(b.from, b.to)), height = Math.max(0.8, Math.abs(h(b.to) - h(b.from)));
          return (
            <div key={i} className="relative h-full" data-tip={b.tip}>
              <div className="absolute inset-x-0 rounded" style={{ bottom: `${bottom}%`, height: `${height}%`, background: b.color }} />
              {b.brk && <div className="absolute -inset-x-0.5 bottom-[18px] h-[7px]" style={{ background: "repeating-linear-gradient(135deg,transparent 0 4px,#fff 4px 6px)" }} />}
              <div className="absolute inset-x-0 text-center text-sm font-semibold sm:text-[15px]" style={{ ...NUM, color: RC.ink, bottom: `calc(${bottom + height}% + 4px)` }}>{b.label}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2.5 text-center">
        {caps.map(([t, sub]) => (
          <div key={t}><b className="block text-[11px] font-semibold leading-tight sm:text-xs">{t}</b><span className="text-[10.5px]" style={{ color: RC.muted }}>{sub}</span></div>
        ))}
      </div>
      <p className="mt-1.5 text-[10.5px]" style={{ color: RC.muted }}>Шкала начинается с {floor}&nbsp;%, чтобы приросты были видны.</p>
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

