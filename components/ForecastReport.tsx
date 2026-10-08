"use client";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { IconDownload } from "./Icons";
import { MultiSelect } from "./MultiSelect";
import type { ForecastFilters } from "./ForecastTable";
import { EMPTY_FILTERS, filterRows, regionKey, type ViewRow } from "@/lib/forecastView";
import { lastDataMonth } from "@/lib/logic";
import { RC, evenCeil, fmtNum, fmtPct, groupSplit, shortRegion, splitGrowth, ticks } from "@/lib/report";
import { isActiveIndex, type Reference } from "@/lib/types";
import type { ForecastRow } from "@/lib/forecast";
import { plural } from "@/lib/forecastView";

const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const SOURCE_CODES = ["MER_FORECAST", "ROSSTAT_ICP", "CBR"];
const NUM = { fontVariantNumeric: "tabular-nums" } as const;

type Group = { key: string; label?: string; total: number; intra: number; industry: number };

/**
 * Отчёт для закупщиков: три листа, одинаковые на экране и в PDF.
 * Срез — общие с вкладкой «Прогноз» фильтры «Категория» и «Регион»; статус не учитывается.
 */
export function ForecastReport({ view, filters, reference, year, baseYear, approved, approvedAt, title }: {
  view: ViewRow[]; filters: ForecastFilters; reference: Reference;
  year: number; baseYear: number; approved: boolean; approvedAt: string | null; title: string;
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
  const regions = useMemo(() => regionTable(rows), [rows]);
  const multi = regions.filter((x) => x.regs.length >= 2);
  const single = regions.filter((x) => x.regs.length === 1);

  // Сравнение с инфляцией — по округлённым до 0,1 значениям, как они показаны
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const above = cpi == null ? 0 : subjects.filter((g) => r1(g.total) > r1(cpi)).length;
  const equal = cpi == null ? 0 : subjects.filter((g) => r1(g.total) === r1(cpi)).length;
  const top = subjects[0];
  const widest = multi.map((x) => ({ x, d: x.regs[0].fc > 0 ? (x.regs[x.regs.length - 1].fc / x.regs[0].fc - 1) * 100 : 0 })).sort((a, b) => b.d - a.d)[0];

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
    const head = [[`Прогноз цен ${year} — ${title}`], [`Срез: ${sliceText}${approved ? "" : ". Прогноз не утверждён"}`], []];
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
      [`Рост отрасли в ${year} (прогноз МЭР)`, p1(total.industry), "п.п."],
      [`Прогноз ${year} к цене договоров ${baseYear}`, p1(100 + total.total), "%"],
    ], [62, 14, 8]);
    add("Рост по категориям", [...head,
      ["Категория", `Рост цен в ${baseYear}, п.п.`, `Рост отрасли в ${year}, п.п.`, "Итого рост, %"],
      ...cats.map((c) => [c.key || "Без категории", p1(c.intra), p1(c.industry), p1(c.total)]),
    ], [48, 18, 20, 14]);
    add("Рост по предметам", [...head,
      ["Предмет закупки", `Рост цен в ${baseYear}, п.п.`, `Рост отрасли в ${year}, п.п.`, "Итого рост, %"],
      ...subjects.map((g) => [g.key, p1(g.intra), p1(g.industry), p1(g.total)]),
    ], [60, 18, 20, 14]);
    const reg = regionTable(rows).filter((x) => x.regs.length >= 2);
    if (reg.length) add("Цена по регионам", [...head,
      ["Предмет закупки", "Ед.", "Регион", `Цена ${baseYear}, ₽ без НДС`, `Прогноз ${year}, ₽ без НДС`, "Отличие от минимума, %"],
      ...reg.flatMap((it) => it.regs.map((r, i) => [it.subject, it.unit, r.name, Math.round(r.base * 100) / 100, Math.round(r.fc * 100) / 100,
        i === 0 ? "минимум" : p1((r.fc / it.regs[0].fc - 1) * 100)])),
    ], [50, 10, 40, 20, 20, 20]);
    add("Источники", [["Источник", "Ссылка"], ...sources.map((x) => [x.name, x.url])], [70, 70]);
    const { downloadWorkbook } = await import("@/lib/excel");
    downloadWorkbook(wb, `Отчёт — прогноз цен ${year} — ${title}${f.category.length || f.region.length ? " (срез)" : ""}${approved ? "" : " (не утверждён)"}.xlsx`.replace(/[\\/:*?"<>|]+/g, " "));
  }
  async function downloadPdf() {
    setPdfBusy(true);
    try {
      setTip(null);
      const { exportPdf } = await import("@/lib/pdfExport");
      const name = `Прогноз цен ${year} — ${title}${f.category.length || f.region.length ? " (срез)" : ""}${approved ? "" : " (не утверждён)"}.pdf`.replace(/[\\/:*?"<>|]+/g, " ");
      await exportPdf(rootRef.current!, name);
    } catch (e) { alert(`Не удалось сформировать PDF: ${e instanceof Error ? e.message : e}`); }
    setPdfBusy(false);
  }

  const legend = <Legend year={year} baseYear={baseYear} cpi={cpi} />;

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
        <div className="ml-auto flex gap-2">
          <button className="btn-sec" disabled={pdfBusy || !rows.length} onClick={downloadPdf}><IconDownload />{pdfBusy ? "Готовим PDF…" : "PDF"}</button>
          <button className="btn-sec" disabled={!rows.length} onClick={downloadExcel}><IconDownload />Excel</button>
        </div>
      </div>

      {!rows.length ? <div className="card text-sm" style={{ color: RC.muted }}>В выбранном срезе нет позиций.</div> : (
        <div ref={rootRef} className="space-y-6">
          {/* Лист 1. Сводка */}
          <Sheet>
            <div>
              <h2 className="text-xl font-semibold">Прогноз цен {year}</h2>
              <p className="mt-0.5 text-sm" style={{ color: RC.ink2 }}>
                {title} · {sliceText} · база: договоры {baseYear}, цены без НДС{approvedAt ? ` · утверждён ${new Date(approvedAt).toLocaleDateString("ru-RU")}` : ""}
              </p>
              {!approved && <p className="mt-1 text-sm font-semibold" style={{ color: RC.warn }}>Прогноз не утверждён, цифры могут измениться</p>}
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl px-4 py-3 text-white" style={{ background: RC.navy }}>
                <p className="text-xs text-white/75">Средний рост цен в {year}</p>
                <p className="my-0.5 text-2xl font-bold sm:text-[26px]" style={NUM}>{fmtPct(total.total)}</p>
                <p className="text-[11.5px] text-white/75">{cpi != null ? `инфляция, прогноз ${cpiSource}: ${fmtPct(cpi)}` : "прогноза инфляции в базе нет"}</p>
              </div>
              {cpi != null && <Kpi label="Дороже инфляции" value={<>{above} <small className="text-sm font-medium" style={{ color: RC.ink2 }}>из {subjects.length}</small></>}
                note={`${plural(subjects.length, "предмет", "предмета", "предметов")} закупки растут быстрее ${fmtNum(cpi)} %`} />}
              {top && <Kpi label="Максимальный рост" value={fmtPct(top.total)} note={top.key} />}
              {widest && <Kpi label="Разница цен между регионами" value={`до +${fmtNum(widest.d, 0)} %`} note={widest.x.subject} />}
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
              <Box title="Из чего складывается рост"><Waterfall split={total} year={year} baseYear={baseYear} lastMonth={lastMonth} /></Box>
              {cats.length > 0 && (
                <Box title="Рост по категориям">
                  {legend}
                  <StackedBars groups={cats.map((c) => ({ ...c, label: shortCat(c.key), full: c.key || "Без категории" }))} cpi={cpi} year={year} baseYear={baseYear} parts labelWidth="7rem" />
                </Box>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border-[1.5px] border-dashed px-4 py-2.5 text-xs" style={{ borderColor: "#C6CBE0", color: RC.ink2 }}>
              <b className="text-[13px]" style={{ color: RC.ink }}>Сколько заложить в бюджет {year}</b>
              <span>Здесь будет сумма в рублях по каждой категории: объём × прогнозная цена, с НДС и без. Для этого нужно сохранять количество из ГПЗ — пока его в прогнозе нет.</span>
            </div>
          </Sheet>

          {/* Лист 2. Предметы закупки */}
          <Sheet>
            <div>
              <h2 className="text-xl font-semibold">Рост по предмету закупки</h2>
              <p className="mt-0.5 text-sm" style={{ color: RC.ink2 }}>По убыванию прогноза роста. Полное название и вклад каждого фактора — при наведении.</p>
            </div>
            {cpi != null && <Strip above={above} equal={equal} below={subjects.length - above - equal} cpi={cpi} />}
            <div className="-mt-2">
              <Legend year={year} baseYear={baseYear} cpi={cpi} extra={cpi != null && equal > 0
                ? <span className="inline-flex items-center gap-1"><Flag />рост ровно на уровне инфляции — стоит проверить источник индекса</span> : null} />
            </div>
            <ItemColumns groups={subjects} cpi={cpi} year={year} baseYear={baseYear} />
          </Sheet>

          {/* Лист 3. Регионы */}
          <Sheet>
            <div>
              <h2 className="text-xl font-semibold">Цена по регионам</h2>
              <p className="mt-0.5 text-sm" style={{ color: RC.ink2 }}>Насколько прогнозная цена {year} в регионе выше самой низкой. Ориентир берите по своему региону. Цены без НДС.</p>
            </div>
            {multi.length > 0 ? <>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]" style={{ color: RC.ink2 }}>
                <span className="inline-flex items-center gap-1.5"><Dot c={RC.navy} />самая низкая цена</span>
                <span className="inline-flex items-center gap-1.5"><Dot c={RC.blue} />другие регионы</span>
                <span className="inline-flex items-center gap-1.5"><Dot c={RC.violet} />самая высокая цена</span>
              </div>
              <DotPlot items={multi} year={year} baseYear={baseYear} />
            </> : <p className="text-sm" style={{ color: RC.muted }}>В срезе нет предметов, которые закупаются в двух и более регионах — сравнивать не с чем.</p>}
            {single.length > 0 && (
              <p className="text-xs" style={{ color: RC.ink2 }}>
                <b style={{ color: RC.ink }}>Только в одном регионе: </b>
                {single.map((x) => `${x.subject} (${shortRegion(x.regs[0].name)})`).join(" · ")}
              </p>
            )}
            {sources.length > 0 && (
              <p className="text-[10.5px]" style={{ color: RC.muted }}>
                Источники:{" "}
                {sources.map((s, i) => <span key={s.code}>{i > 0 && " · "}<a href={s.url} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: RC.blue }}>{s.name}</a></span>)}
              </p>
            )}
          </Sheet>
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

const Dot = ({ c }: { c: string }) => <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />;
const Flag = () => <span className="whitespace-nowrap rounded px-1 py-px text-[9.5px] font-semibold" style={{ color: RC.blue, background: "#E8EEFC" }}>= инфл.</span>;

function Legend({ year, baseYear, cpi, extra }: { year: number; baseYear: number; cpi: number | null; extra?: ReactNode }) {
  const sq = (c: string) => <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]" style={{ color: RC.ink2 }}>
      <span className="inline-flex items-center gap-1.5">{sq(RC.sky)}рост цен в {baseYear}</span>
      <span className="inline-flex items-center gap-1.5">{sq(RC.blue)}рост отрасли в {year}</span>
      {cpi != null && <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 border-l-2 border-dashed" style={{ borderColor: RC.navy }} />инфляция {fmtNum(cpi)}&nbsp;%</span>}
      {extra}
    </div>
  );
}

/** Водопад: цена договоров → рост внутри базового года → рост отрасли → прогноз. Ось обрезана снизу — показан разрыв */
function Waterfall({ split, year, baseYear, lastMonth }: { split: { total: number; intra: number; industry: number }; year: number; baseYear: number; lastMonth: number | null }) {
  const lo = Math.min(100, 100 + split.intra, 100 + split.total);
  const hi = Math.max(100, 100 + split.intra, 100 + split.total);
  const floor = Math.max(0, Math.floor(lo - Math.max(hi - lo, 2) * 1.2));
  const h = (v: number) => ((v - floor) / (hi - floor || 1)) * 100;
  const bars = [
    { from: floor, to: 100, color: RC.navy, label: "100 %", brk: true, tip: `Медианная цена договоров ${baseYear} без НДС принята за 100 %` },
    { from: 100, to: 100 + split.intra, color: RC.sky, label: fmtPct(split.intra), tip: `Пересчёт цены договора до последнего месяца с данными Росстата: ${fmtPct(split.intra)}` },
    { from: 100 + split.intra, to: 100 + split.total, color: RC.blue, label: fmtPct(split.industry), tip: `Рост цен в отрасли в ${year} по прогнозу: ${fmtPct(split.industry)}` },
    { from: floor, to: 100 + split.total, color: RC.violet, label: `${fmtNum(100 + split.total)} %`, inside: true, brk: true, tip: `Прогноз цены ${year} к цене договоров ${baseYear}` },
  ];
  const caps: [string, string][] = [
    [`Цена договоров ${baseYear}`, "медиана, без НДС"],
    [`Рост цен в ${baseYear}`, `Росстат${lastMonth ? `, до ${MONTHS_GEN[lastMonth - 1]}` : ""}`],
    [`Рост отрасли в ${year}`, "прогноз МЭР"],
    [`Прогноз ${year}`, `к цене договоров ${baseYear}`],
  ];
  return (
    <div>
      <div className="mt-6 grid h-56 grid-cols-4 gap-2.5 border-b sm:h-[250px]" style={{ borderColor: RC.line }}>
        {bars.map((b, i) => {
          const bottom = h(Math.min(b.from, b.to)), height = Math.max(0.8, Math.abs(h(b.to) - h(b.from)));
          return (
            <div key={i} className="relative h-full" data-tip={b.tip}>
              <div className="absolute inset-x-0 rounded" style={{ bottom: `${bottom}%`, height: `${height}%`, background: b.color }} />
              {b.brk && <div className="absolute -inset-x-0.5 bottom-[18px] h-[7px]" style={{ background: "repeating-linear-gradient(135deg,transparent 0 4px,#fff 4px 6px)" }} />}
              <div className="absolute inset-x-0 text-center text-sm font-semibold sm:text-[15px]" style={{ ...NUM, color: b.inside ? "#fff" : RC.ink, bottom: b.inside ? `calc(${bottom + height}% - 26px)` : `calc(${bottom + height}% + 4px)` }}>{b.label}</div>
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

/** Ось баров: от нуля (или минимума ниже нуля) до чётного целого над максимумом и инфляцией */
function barDomain(groups: Group[], cpi: number | null) {
  const max = evenCeil(Math.max(...groups.map((g) => g.total), cpi ?? 0));
  const minT = Math.min(...groups.map((g) => g.total), 0);
  const min = minT < 0 ? -evenCeil(-minT) : 0;
  const step = max - min <= 12 ? 2 : 5;
  return { min, max, ticks: ticks(min, max, step) };
}

/** Горизонтальный бар из двух частей: голубая — рост в базовом году, синяя — рост отрасли; отрицательный итог — влево от нуля */
function Bar({ g, min, max, cpi, tip, tall }: { g: Group; min: number; max: number; cpi: number | null; tip: string; tall?: boolean }) {
  const x = (v: number) => ((v - min) / (max - min)) * 100;
  const z = x(0);
  const a = Math.max(0, Math.min(g.intra, g.total));
  return (
    <div className={`relative ${tall ? "h-4" : "h-3"} rounded-[3px]`} style={{ background: RC.track }} data-tip={tip}>
      {g.total < 0 ? (
        <div className="absolute inset-y-0 rounded-l-[3px]" style={{ left: `${x(g.total)}%`, width: `${z - x(g.total)}%`, background: RC.blue }} />
      ) : <>
        {a > 0 && <div className="absolute inset-y-0 rounded-l-[3px]" style={{ left: `${z}%`, width: `calc(${x(a) - z}% - 1px)`, background: RC.sky }} />}
        {g.total - a > 0 && <div className={`absolute inset-y-0 ${a > 0 ? "rounded-r-[3px]" : "rounded-[3px]"}`}
          style={{ left: `calc(${x(a)}% + ${a > 0 ? 1 : 0}px)`, width: `calc(${x(g.total) - x(a)}% - ${a > 0 ? 1 : 0}px)`, background: RC.blue }} />}
      </>}
      {min < 0 && <div className="absolute -inset-y-[3px] border-l" style={{ left: `${z}%`, borderColor: RC.muted }} />}
      {cpi != null && <div className="absolute -inset-y-1 border-l-2 border-dashed" style={{ left: `${x(cpi)}%`, borderColor: RC.navy }} />}
    </div>
  );
}

function Axis({ min, max, values }: { min: number; max: number; values: number[] }) {
  return (
    <div className="relative h-3.5 text-[10px]" style={{ color: RC.muted }}>
      {values.map((t, i) => (
        <span key={t} className={`absolute -translate-x-1/2 whitespace-nowrap ${i === 0 || i === values.length - 1 || t === 0 ? "" : "hidden sm:inline"}`}
          style={{ ...NUM, left: `${((t - min) / (max - min)) * 100}%` }}>{fmtNum(t, 0)}&nbsp;%</span>
      ))}
    </div>
  );
}

const tipOf = (name: string, g: Group, year: number, baseYear: number) =>
  `${name}: рост цен в ${baseYear} ${fmtPct(g.intra)} + рост отрасли в ${year} ${fmtPct(g.industry)} = ${fmtPct(g.total)}`;

/** Бары по категориям: название, бар, итог и разложение */
function StackedBars({ groups, cpi, year, baseYear, parts, labelWidth }: {
  groups: (Group & { full?: string })[]; cpi: number | null; year: number; baseYear: number; parts?: boolean; labelWidth: string;
}) {
  const d = barDomain(groups, cpi);
  return (
    <div className="mt-4 grid items-center gap-x-2.5 gap-y-3.5" style={{ gridTemplateColumns: `minmax(0,${labelWidth}) minmax(0,1fr) 72px` }}>
      {groups.map((g) => (
        <Row key={g.key}>
          <span className="text-xs leading-tight" data-tip={g.full ?? g.key}>{g.label ?? g.key}</span>
          <Bar g={g} min={d.min} max={d.max} cpi={cpi} tall tip={tipOf(g.full ?? g.key, g, year, baseYear)} />
          <span className="text-right text-[12.5px] font-semibold" style={NUM}>
            {fmtPct(g.total)}
            {parts && <span className="block whitespace-nowrap text-[10.5px] font-normal" style={{ color: RC.muted }}>{fmtNum(g.intra)} + {fmtNum(g.industry)}</span>}
          </span>
        </Row>
      ))}
      <span /><Axis min={d.min} max={d.max} values={d.ticks} /><span />
    </div>
  );
}

const Row = ({ children }: { children: ReactNode }) => <>{children}</>;

/** Бары по предметам: две колонки с общей осью, по убыванию роста */
function ItemColumns({ groups, cpi, year, baseYear }: { groups: Group[]; cpi: number | null; year: number; baseYear: number }) {
  const d = barDomain(groups, cpi);
  const half = Math.ceil(groups.length / 2);
  const col = (list: Group[]) => (
    <div className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_52px] items-center gap-x-2.5 gap-y-2.5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_52px]">
      {list.map((g) => (
        <Row key={g.key}>
          <span className="line-clamp-2 text-xs leading-tight" data-tip={g.key}>
            {g.key}{cpi != null && r1(g.total) === r1(cpi) && <span className="ml-1"><Flag /></span>}
          </span>
          <Bar g={g} min={d.min} max={d.max} cpi={cpi} tip={tipOf(g.key, g, year, baseYear)} />
          <span className="text-right text-[12.5px] font-semibold" style={NUM}>{fmtPct(g.total)}</span>
        </Row>
      ))}
      <span /><Axis min={d.min} max={d.max} values={d.ticks} /><span />
    </div>
  );
  return (
    <div className="grid gap-x-9 gap-y-2.5 lg:grid-cols-2">
      {col(groups.slice(0, half))}
      {groups.length > half && col(groups.slice(half))}
    </div>
  );
}
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Полоса «дороже / на уровне / ниже инфляции», ширина по количеству */
function Strip({ above, equal, below, cpi }: { above: number; equal: number; below: number; cpi: number }) {
  const parts = [
    { n: above, label: "дороже инфляции", bg: RC.blue, tip: `Прогноз роста выше ${fmtNum(cpi)} %` },
    { n: equal, label: "на уровне инфляции", bg: RC.sky, tip: `Прогноз роста ровно ${fmtNum(cpi)} %` },
    { n: below, label: "ниже", bg: RC.navy, tip: `Прогноз роста ниже ${fmtNum(cpi)} %` },
  ].filter((p) => p.n > 0);
  return (
    <div className="flex h-[26px] gap-0.5 overflow-hidden rounded-md text-[11.5px] font-semibold text-white" style={NUM}>
      {parts.map((p) => (
        <div key={p.label} className="flex min-w-0 items-center overflow-hidden whitespace-nowrap pl-2.5" style={{ flex: Math.max(p.n, 1.6), background: p.bg }} data-tip={p.tip}>
          {p.n} {p.label}
        </div>
      ))}
    </div>
  );
}

/** Все предметы среза с регионами: регионы по возрастанию прогноза */
function regionTable(rows: ForecastRow[]) {
  const m = new Map<string, ForecastRow[]>();
  for (const r of rows) { const k = `${r.subject}|${r.unitLabel}`; m.get(k)?.push(r) ?? m.set(k, [r]); }
  return [...m.values()].map((rs) => {
    // Несколько строк одного региона (разные коды WS) — среднее
    const byReg = new Map<string, ForecastRow[]>();
    for (const r of rs) { const k = r.regionName ?? r.region ?? "Регион не указан"; byReg.get(k)?.push(r) ?? byReg.set(k, [r]); }
    const regs = [...byReg.entries()].map(([name, g]) => ({
      name, base: g.reduce((s, r) => s + r.basePrice, 0) / g.length, fc: g.reduce((s, r) => s + r.forecastPrice, 0) / g.length,
    })).sort((x, y) => x.fc - y.fc);
    return { subject: rs[0].subject, unit: rs[0].unitLabel, regs };
  });
}

const rubShort = (v: number) => (v >= 1e6 ? `${fmtNum(v / 1e6)} млн ₽` : `${Math.round(v).toLocaleString("ru-RU").replace(/\s/g, " ")} ₽`);

/** Точечный график: насколько прогноз в регионе выше минимального по предмету */
function DotPlot({ items, year, baseYear }: { items: ReturnType<typeof regionTable>; year: number; baseYear: number }) {
  const rows = items.map((it) => ({ ...it, regs: it.regs.map((r) => ({ ...r, d: it.regs[0].fc > 0 ? (r.fc / it.regs[0].fc - 1) * 100 : 0 })) }))
    .sort((a, b) => b.regs[b.regs.length - 1].d - a.regs[a.regs.length - 1].d);
  const maxD = Math.max(...rows.map((r) => r.regs[r.regs.length - 1].d), 1);
  const step = maxD > 60 ? 25 : maxD > 25 ? 10 : 5;
  const MAX = Math.ceil(maxD / step) * step;
  const X = (p: number) => (p / MAX) * 100;
  const grid = ticks(0, MAX, step);
  return (
    <div className="grid items-center gap-x-4 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_9.5rem]">
      <span className="hidden pb-1.5 text-[10.5px] uppercase tracking-wide sm:block" style={{ color: RC.muted }}>Предмет закупки</span>
      <div className="relative hidden h-4 text-[10px] sm:block" style={{ color: RC.muted }}>
        {grid.map((t) => <span key={t} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ ...NUM, left: `${X(t)}%` }}>+{t}&nbsp;%</span>)}
      </div>
      <span className="hidden pb-1.5 text-right text-[10.5px] uppercase tracking-wide sm:block" style={{ color: RC.muted }}>Прогноз {year}</span>
      {rows.map((r) => {
        const last = r.regs.length - 1;
        // Подпись ставим в ту строку (над или под линией), где она дальше от предыдущей подписи
        const lastIn = { up: -99, dn: -99 };
        return (
          <Row key={`${r.subject}|${r.unit}`}>
            <div className="flex min-h-[46px] flex-wrap content-center gap-x-1 border-t pt-2 text-xs leading-tight sm:pt-0" style={{ borderColor: RC.line }}>
              <span className="line-clamp-2" data-tip={r.subject}>{r.subject}</span> <small style={{ color: RC.muted }}>₽/{r.unit}</small>
            </div>
            <div className="relative h-[30px] sm:h-[46px] sm:border-t" style={{ borderColor: RC.line }}>
              {grid.slice(1).map((t) => <div key={t} className="absolute inset-y-0 border-l border-dotted" style={{ left: `${X(t)}%`, borderColor: "#D5D9E6" }} />)}
              <div className="absolute inset-x-0 top-[22px] h-0.5" style={{ background: RC.track }} />
              <div className="absolute top-[21px] h-1 rounded-sm" style={{ left: 0, width: `${X(r.regs[last].d)}%`, background: RC.span }} />
              {r.regs.map((g, k) => {
                const x = X(g.d);
                const pos: "up" | "dn" = x - lastIn.up >= 15 ? "up" : x - lastIn.dn >= 15 ? "dn" : lastIn.up <= lastIn.dn ? "up" : "dn";
                // Обе строки заняты рядом — подпись сдвигается вправо, точка остаётся на месте
                const lx = Math.min(Math.max(x, lastIn[pos] + 15), 100);
                lastIn[pos] = lx;
                const c = k === 0 ? RC.navy : k === last ? RC.violet : RC.blue;
                const align = lx < 8 ? "translate-x-0" : lx > 88 ? "-translate-x-full" : "-translate-x-1/2";
                return (
                  <span key={g.name}>
                    <span className="absolute top-[23px] -ml-[5.5px] -mt-[5.5px] h-[11px] w-[11px] rounded-full border-2 border-white" style={{ left: `${x}%`, background: c }}
                      data-tip={`${g.name}: ${rubShort(g.base)} → ${rubShort(g.fc)} за ${r.unit}${k ? `, на ${fmtNum(g.d, 0)} % выше минимума` : ", самая низкая цена"}`} />
                    <span className={`absolute hidden whitespace-nowrap text-[10px] sm:inline ${align} ${pos === "up" ? "top-[3px]" : "top-[30px]"}`} style={{ left: `${lx}%`, color: RC.ink2 }}>
                      {shortRegion(g.name)}{k > 0 && <b style={{ color: RC.ink }}> +{fmtNum(g.d, 0)}%</b>}
                    </span>
                  </span>
                );
              })}
            </div>
            <div className="flex flex-col justify-center pb-2 text-[11.5px] sm:h-[46px] sm:border-t sm:pb-0 sm:text-right" style={{ ...NUM, borderColor: RC.line }}>
              <span className="whitespace-nowrap">{rubShort(r.regs[0].fc)} – {rubShort(r.regs[last].fc)}</span>
              <small className="text-[10px]" style={{ color: RC.muted }}>{r.regs.length} {plural(r.regs.length, "регион", "региона", "регионов")}</small>
              <span className="mt-0.5 text-[11px] sm:hidden" style={{ color: RC.ink2 }}>
                {r.regs.map((g, k) => <span key={g.name}>{k > 0 && " · "}{shortRegion(g.name)}{k > 0 ? <b style={{ color: RC.ink }}> +{fmtNum(g.d, 0)}%</b> : " — минимум"}</span>)}
              </span>
            </div>
          </Row>
        );
      })}
      <span className="hidden sm:block" />
      <p className="mt-1 text-[10px] sm:col-span-2" style={{ color: RC.muted }}>Шкала — на сколько прогноз {year} выше самой низкой цены по предмету; цены {baseYear} → {year} — при наведении на точку.</p>
    </div>
  );
}
