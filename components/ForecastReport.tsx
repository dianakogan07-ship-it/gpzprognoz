"use client";
import { useMemo, useState, type ReactNode } from "react";
import { IconDownload } from "./Icons";
import { MultiSelect } from "./MultiSelect";
import type { ForecastFilters } from "./ForecastTable";
import { EMPTY_FILTERS, filterRows, regionKey, type ViewRow } from "@/lib/forecastView";
import { lastDataMonth } from "@/lib/logic";
import { DISTRICTS, districtOf } from "@/lib/districts";
import { RC, evenCeil, fmtNum, fmtPct, fmtRubInt, groupSplit, splitGrowth } from "@/lib/report";
import { isActiveIndex, type Reference } from "@/lib/types";
import type { ForecastRow } from "@/lib/forecast";

const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const SOURCE_CODES = ["MER_FORECAST", "ROSSTAT_ICP", "CBR"];

/**
 * Отчёт для закупщиков: только итог и его обоснование, без технических пометок.
 * Срез — общие с вкладкой «Прогноз» фильтры «Категория» и «Регион»; статус не учитывается.
 */
export function ForecastReport({ view, filters, reference, year, baseYear, approved, approvedAt, title, onExcel }: {
  view: ViewRow[]; filters: ForecastFilters; reference: Reference;
  year: number; baseYear: number; approved: boolean; approvedAt: string | null; title: string;
  onShowAll?: () => void; onExcel: (rows: ViewRow[]) => void;
}) {
  const { f, set } = filters;
  const slice = useMemo(() => filterRows(view, { ...EMPTY_FILTERS, category: f.category, region: f.region }), [view, f.category, f.region]);
  const rows = useMemo(() => slice.map((v) => v.row), [slice]);
  const total = useMemo(() => splitGrowth(rows), [rows]);
  const contracts = rows.reduce((s, r) => s + r.contracts, 0);
  const cpiIx = reference.indices.find((i) => i.kind === "cpi" && i.year === year && isActiveIndex(i));
  const cpi = cpiIx ? (cpiIx.value - 1) * 100 : null;
  const lastMonth = lastDataMonth(reference.indices, baseYear);
  const shortCat = (name: string) => reference.categories.find((c) => c.name === name)?.short_name || name || "Без категории";
  const cats = useMemo(() => groupSplit(rows, (r) => r.category ?? ""), [rows]);
  const subjects = useMemo(() => groupSplit(rows, (r) => r.subject), [rows]);

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
  ].join("; ");
  const sources = reference.sources.filter((s) => SOURCE_CODES.includes(s.code));
  const lock = approved ? undefined : "Выгрузка доступна после утверждения прогноза";

  return (
    <div className="report space-y-4" style={{ color: RC.ink }}>
      {/* Заголовок для печати */}
      <div className="hidden print:block">
        <h1 className="text-2xl font-semibold">Прогноз цен {year}</h1>
        <p className="text-sm" style={{ color: RC.muted }}>{title}{approvedAt ? ` · утверждён ${new Date(approvedAt).toLocaleDateString("ru-RU")}` : ""} · {sliceText}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <MultiSelect label="Категория" value={f.category} onChange={(category) => set({ category })}
          options={[...counts.cat.entries()].sort().map(([c, n]) => ({ value: c, label: c || "Без категории", count: n }))} />
        <MultiSelect label="Регион" searchable value={f.region} onChange={(region) => set({ region })}
          options={[...counts.reg.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, "ru")).map(([k, e]) => ({ value: k, label: e.label, count: e.n }))} />
        <span className="hidden text-xs sm:inline" style={{ color: RC.muted }}>Фильтры общие с вкладкой «Прогноз»</span>
        <div className="ml-auto flex gap-2">
          <button className="btn-sec" disabled={!approved} title={lock} onClick={() => window.print()}><IconDownload />PDF</button>
          <button className="btn-sec" disabled={!approved} title={lock} onClick={() => onExcel(slice)}><IconDownload />Excel</button>
        </div>
      </div>

      {!rows.length ? <div className="card text-sm" style={{ color: RC.muted }}>В выбранном срезе нет позиций.</div> : <>
        {/* KPI */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl p-5 text-white" style={{ background: RC.navy }}>
            <p className="text-sm text-white/80">Средний рост цен в {year}</p>
            <p className="mt-1 text-3xl font-semibold">{fmtPct(total.total)}</p>
            {cpi != null && <p className="mt-1 text-xs text-white/80">инфляция по прогнозу МЭР: {fmtPct(cpi)}</p>}
          </div>
          <Kpi label="Предметов закупки" value={rows.length} note={`с ориентиром цены на ${year}`} />
          <Kpi label="Договоров в основе" value={contracts} note={`заключены в ${baseYear}`} />
        </div>

        <Waterfall split={total} year={year} baseYear={baseYear} lastMonth={lastMonth} />

        {cats.length > 0 && (
          <DistrictCard title="Рост по категории" rows={rows} year={year} baseYear={baseYear} cpi={cpi}>
            {(rs) => <Radial groups={groupSplit(rs, (r) => r.category ?? "").map((c) => ({ ...c, label: shortCat(c.key) }))} cpi={cpi} />}
          </DistrictCard>
        )}
        {subjects.length > 0 && (
          <DistrictCard title="Рост по предмету закупки" rows={rows} year={year} baseYear={baseYear} cpi={cpi}>
            {(rs) => <Bars groups={groupSplit(rs, (r) => r.subject)} cpi={cpi} />}
          </DistrictCard>
        )}

        <Regions rows={rows} year={year} baseYear={baseYear} />

        {sources.length > 0 && (
          <p className="pt-2 text-center text-xs" style={{ color: RC.muted }}>
            Источники:{" "}
            {sources.map((s, i) => <span key={s.code}>{i > 0 && " · "}<a href={s.url} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: RC.blue }}>{s.name}</a></span>)}
          </p>
        )}
      </>}
    </div>
  );
}

function Kpi({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-sm" style={{ color: RC.muted }}>{label}</p>
      <p className="mt-1 text-3xl font-semibold">{value.toLocaleString("ru-RU")} <span className="text-base font-normal" style={{ color: RC.muted }}>шт.</span></p>
      <p className="mt-1 text-xs" style={{ color: RC.muted }}>{note}</p>
    </div>
  );
}

function Card({ title, sub, action, children }: { title: string; sub?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 break-inside-avoid rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{title}</h2>{action}</div>
      {sub && <p className="mt-0.5 text-sm" style={{ color: RC.muted }}>{sub}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Legend({ year, baseYear, cpi }: { year: number; baseYear: number; cpi: number | null }) {
  const dot = (c: string) => <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />;
  return (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: RC.muted }}>
      <span className="inline-flex items-center gap-1.5">{dot(RC.sky)}рост цен в {baseYear}</span>
      <span className="inline-flex items-center gap-1.5">{dot(RC.blue)}рост отрасли в {year}</span>
      {cpi != null && <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 border-l-2 border-dashed" style={{ borderColor: RC.navy }} />инфляция МЭР {fmtNum(cpi)}&nbsp;%</span>}
    </div>
  );
}

/** Водопад: цена договоров → рост внутри базового года → рост отрасли → прогноз */
function Waterfall({ split, year, baseYear, lastMonth }: { split: { total: number; intra: number; industry: number }; year: number; baseYear: number; lastMonth: number | null }) {
  const lo = Math.min(100, 100 + split.intra, 100 + split.total);
  const hi = Math.max(100, 100 + split.intra, 100 + split.total);
  // Шкала: основание столбца «100 %» видно, прирост — крупно
  const floor = Math.max(0, lo - Math.max(hi - lo, 2) * 1.2);
  const h = (v: number) => ((v - floor) / (hi - floor || 1)) * 100;
  const bars = [
    { from: floor, to: 100, color: RC.navy, label: "100\u00a0%", lc: RC.ink },
    { from: 100, to: 100 + split.intra, color: RC.sky, label: fmtPct(split.intra), lc: "#0E7FC7" },
    { from: 100 + split.intra, to: 100 + split.total, color: RC.blue, label: fmtPct(split.industry), lc: RC.blue },
    { from: floor, to: 100 + split.total, color: RC.violet, label: `${fmtNum(100 + split.total)}\u00a0%`, lc: "#fff", inside: true },
  ];
  const caps: [string, string][] = [
    [`Цена договоров ${baseYear}`, "медиана, без НДС"],
    [`Рост цен в ${baseYear}`, `пересчёт до последнего месяца с данными (Росстат)${lastMonth ? `, до ${MONTHS_GEN[lastMonth - 1]}` : ""}`],
    [`Рост отрасли в ${year}`, "прогноз МЭР"],
    [`Прогноз ${year}`, `к цене договоров ${baseYear}`],
  ];
  return (
    <Card title="Из чего складывается рост">
      <div className="grid grid-cols-4 gap-2 border-b border-slate-300 pt-8 sm:gap-6 sm:px-6 sm:pt-10">
        {bars.map((b, i) => {
          const bottom = h(Math.min(b.from, b.to)), height = Math.max(0.8, Math.abs(h(b.to) - h(b.from)));
          return (
            <div key={i} className="relative h-44 sm:h-56">
              {i < 3 && <span className="absolute -right-2 left-full border-t border-dashed sm:-right-6" style={{ bottom: `${h(b.to)}%`, borderColor: "#9AA3B5" }} />}
              <div className="absolute inset-x-0 rounded-md" style={{ bottom: `${bottom}%`, height: `${height}%`, background: b.color }}>
                {b.inside && <span className="absolute inset-x-0 top-2 text-center text-sm font-semibold sm:text-2xl" style={{ color: b.lc }}>{b.label}</span>}
              </div>
              {!b.inside && <span className="absolute inset-x-0 text-center text-sm font-semibold sm:text-2xl" style={{ bottom: `calc(${bottom + height}% + 6px)`, color: b.lc }}>{b.label}</span>}
            </div>
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center sm:gap-6 sm:px-6">
        {caps.map(([t, sub]) => (
          <div key={t}>
            <p className="text-[11px] font-semibold leading-tight sm:text-sm">{t}</p>
            <p className="mt-0.5 hidden text-xs sm:block" style={{ color: RC.muted }}>{sub}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

type Group = { key: string; label?: string; total: number; intra: number; industry: number };

/** Радиальная диаграмма: кольцо на категорию, 270° = максимум шкалы */
function Radial({ groups, cpi }: { groups: Group[]; cpi: number | null }) {
  const max = evenCeil(Math.max(...groups.map((g) => g.total), cpi ?? 0));
  const cx = 150, cy = 150, ring = 14, gap = 5, R = 130;
  const ang = (v: number) => (Math.max(0, v) / max) * 270;
  const pt = (r: number, deg: number) => { const a = ((deg - 90) * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const arc = (r: number, d0: number, d1: number) => {
    if (d1 - d0 < 0.2) return "";
    const [x0, y0] = pt(r, d0), [x1, y1] = pt(r, d1);
    return `M ${x0} ${y0} A ${r} ${r} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const rings = groups.slice(0, 7);
  const rIn = R - (rings.length - 1) * (ring + gap);
  const cpiDeg = cpi != null ? ang(cpi) : null;
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <svg viewBox="-10 -10 320 320" className="mx-auto w-full max-w-[320px] shrink-0" role="img" aria-label="Рост по категории">
        {rings.map((g, i) => {
          const r = R - i * (ring + gap);
          // Отрицательная часть не рисуется: синяя дуга заканчивается на итоге
          const a = ang(Math.min(g.intra, g.total)), b = ang(g.total);
          return (
            <g key={g.key}>
              <path d={arc(r, 0, 270)} stroke={RC.track} strokeWidth={ring} fill="none" />
              <path d={arc(r, 0, a)} stroke={RC.sky} strokeWidth={ring} fill="none" />
              <path d={arc(r, a, b)} stroke={RC.blue} strokeWidth={ring} fill="none" />
              <text x={cx - 6} y={cy - r + 4} textAnchor="end" fontSize={10} fill={RC.muted}>{g.label}</text>
            </g>
          );
        })}
        {cpiDeg != null && (() => {
          const [x0, y0] = pt(rIn - ring, cpiDeg), [x1, y1] = pt(R + ring / 2 + 2, cpiDeg), [bx, by] = pt(R + ring / 2 + 20, cpiDeg);
          return (
            <g>
              <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="#fff" strokeWidth={5} />
              <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={RC.navy} strokeWidth={2} strokeDasharray="4 3" />
              <rect x={Math.min(Math.max(bx, 14), 286) - 24} y={Math.min(Math.max(by, 2), 298) - 10} width={48} height={20} rx={5} fill={RC.navy} />
              <text x={Math.min(Math.max(bx, 14), 286)} y={Math.min(Math.max(by, 2), 298) + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="#fff">{fmtNum(cpi!)}&nbsp;%</text>
            </g>
          );
        })()}
      </svg>
      <ul className="min-w-0 flex-1 space-y-2.5">
        {rings.map((g) => (
          <li key={g.key} className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-sm">{g.label}</span>
              <span className="block whitespace-nowrap text-xs" style={{ color: RC.muted }}>{fmtNum(g.intra)}&nbsp;% + {fmtNum(g.industry)}&nbsp;%</span>
            </span>
            <span className="whitespace-nowrap text-sm font-semibold">{fmtPct(g.total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Полосы по предметам закупки: две части роста и пунктир инфляции */
function Bars({ groups: all, cpi }: { groups: Group[]; cpi: number | null }) {
  const [open, setOpen] = useState(false);
  const groups = open ? all : all.slice(0, 8);
  const max = evenCeil(Math.max(...all.map((g) => g.total), cpi ?? 0));
  const pct = (v: number) => `${(Math.max(0, v) / max) * 100}%`;
  return (
    <div>
      <ul className="space-y-2.5">
        {groups.map((g) => (
          <li key={g.key} className="grid grid-cols-[8rem_minmax(0,1fr)_4rem] items-center gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_4.5rem]">
            <span className="hyphens-auto break-words text-sm leading-tight" lang="ru">{g.key}</span>
            <span className="relative h-4 overflow-hidden rounded" style={{ background: RC.bg }}>
              <span className="absolute inset-y-0 left-0" style={{ width: pct(Math.min(g.intra, g.total)), background: RC.sky }} />
              <span className="absolute inset-y-0" style={{ left: pct(Math.min(g.intra, g.total)), width: pct(g.total - Math.max(0, Math.min(g.intra, g.total))), background: RC.blue }} />
              {cpi != null && <span className="absolute -inset-y-1 border-l-2 border-dashed" style={{ left: pct(cpi), borderColor: RC.navy }} />}
            </span>
            <span className="whitespace-nowrap text-right text-sm font-semibold">{fmtPct(g.total)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-1 grid grid-cols-[8rem_minmax(0,1fr)_4rem] gap-3 text-[11px] sm:grid-cols-[12rem_minmax(0,1fr)_4.5rem]" style={{ color: RC.muted }}>
        <span />
        <span className="flex justify-between"><span>0&nbsp;%</span><span>{fmtNum(max / 2, 0)}&nbsp;%</span><span>{fmtNum(max, 0)}&nbsp;%</span></span>
        <span />
      </div>
      {all.length > 8 && (
        <button type="button" className="mt-3 text-sm font-medium print:hidden" style={{ color: RC.blue }} onClick={() => setOpen(!open)}>
          {open ? "Свернуть ▴" : `Показать все ${all.length} ▾`}
        </button>
      )}
    </div>
  );
}

/** Карточка графика с выбором федерального округа */
function DistrictCard({ title, rows, year, baseYear, cpi, children }: {
  title: string; rows: ForecastRow[]; year: number; baseYear: number; cpi: number | null; children: (rows: ForecastRow[]) => ReactNode;
}) {
  const [d, setD] = useState("");
  const present = DISTRICTS.filter((x) => rows.some((r) => districtOf(r.region) === x));
  const rs = d ? rows.filter((r) => districtOf(r.region) === d) : rows;
  return (
    <Card title={title} action={present.length > 1 ? (
      <>
        <select className="inp w-auto py-1.5 print:hidden" value={d} onChange={(e) => setD(e.target.value)} aria-label="Федеральный округ">
          <option value="">Все округа</option>
          {present.map((x) => <option key={x} value={x}>{x} ФО</option>)}
        </select>
        {d && <span className="hidden text-sm print:inline" style={{ color: RC.muted }}>{d} ФО</span>}
      </>
    ) : undefined}>
      <Legend year={year} baseYear={baseYear} cpi={cpi} />
      {rs.length ? children(rs) : <p className="text-sm" style={{ color: RC.muted }}>В этом округе нет позиций.</p>}
    </Card>
  );
}

/** Цена по регионам — для предметов, закупаемых в двух и более регионах */
function Regions({ rows, year, baseYear }: { rows: ForecastRow[]; year: number; baseYear: number }) {
  const items = useMemo(() => {
    const m = new Map<string, ForecastRow[]>();
    for (const r of rows) { const k = `${r.subject}|${r.unitLabel}`; m.get(k)?.push(r) ?? m.set(k, [r]); }
    return [...m.entries()]
      .map(([key, rs]) => ({ key, subject: rs[0].subject, unit: rs[0].unitLabel, rows: rs, sum: rs.reduce((s, r) => s + r.basePrice * r.contracts, 0) }))
      .filter((x) => new Set(x.rows.map((r) => r.regionName ?? r.region ?? "")).size >= 2)
      .sort((a, b) => b.sum - a.sum);
  }, [rows]);
  const [pick, setPick] = useState<string | null>(null);
  if (!items.length) return null;
  const cur = items.find((x) => x.key === pick) ?? items[0];
  // Несколько строк одного региона (разные коды WS) — среднее
  const byReg = new Map<string, ForecastRow[]>();
  for (const r of cur.rows) { const k = r.regionName ?? r.region ?? "Не указан"; byReg.get(k)?.push(r) ?? byReg.set(k, [r]); }
  const regs = [...byReg.entries()].map(([name, rs]) => ({
    name, base: rs.reduce((s, r) => s + r.basePrice, 0) / rs.length, fc: rs.reduce((s, r) => s + r.forecastPrice, 0) / rs.length,
  })).sort((a, b) => a.fc - b.fc);
  const lo = Math.min(...regs.map((r) => r.base)), hi = Math.max(...regs.map((r) => r.fc));
  const pad = (hi - lo) * 0.08 || hi * 0.05;
  const min = lo - pad, max = hi + pad;
  const x = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  return (
    <Card title="Цена по регионам" sub="Один и тот же предмет в разных регионах стоит по-разному — ориентир берите по своему региону">
      <select className="inp w-auto max-w-full print:hidden" value={cur.key} onChange={(e) => setPick(e.target.value)}>
        {items.map((it) => <option key={it.key} value={it.key}>{it.subject}, ₽/{it.unit}</option>)}
      </select>
      <p className="hidden text-sm font-medium print:block">{cur.subject}, ₽/{cur.unit}</p>
      <ul className="mt-4 space-y-4">
        {regs.map((r) => (
          <li key={r.name}>
            <p className="text-sm">{r.name}</p>
            <div className="relative my-2 h-3">
              <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2" style={{ background: RC.track }} />
              <span className="absolute top-1/2 h-0.5 -translate-y-1/2" style={{ left: x(r.base), width: `calc(${x(r.fc)} - ${x(r.base)})`, background: "#8A93A8" }} />
              <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: x(r.base), background: RC.sky }} />
              <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: x(r.fc), background: RC.navy }} />
            </div>
            <p className="text-xs" style={{ color: RC.muted }}>{fmtRubInt(r.base)} → <b style={{ color: RC.ink }}>{fmtRubInt(r.fc)}</b> за {cur.unit}</p>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-between border-t border-slate-100 pt-2 text-[11px]" style={{ color: RC.muted }}>
        <span>{fmtRubInt(min)}</span><span className="hidden sm:inline">{fmtRubInt((min + max) / 2)}</span><span>{fmtRubInt(max)}</span>
      </div>
      <div className="mt-2 flex gap-4 text-xs" style={{ color: RC.muted }}>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: RC.sky }} />цена {baseYear}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: RC.navy }} />прогноз {year}</span>
      </div>
    </Card>
  );
}
