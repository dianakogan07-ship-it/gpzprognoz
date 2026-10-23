import { sql } from "../db";
import { median, unpackPoint, type PackedPoint } from "../forecast";
import type { StoredItem } from "./model";

/** Закупка года: сколько заложил закупщик (НМЦ) и за сколько заключили договор — за единицу без НДС */
export interface AccuracyLot { subject: string; region: string | null; unit: string; lot: string | null; category: string; plan: number; fact: number; dev: number; outlier: boolean; qty: number }
/** Повторяющаяся закупка: тот же код ОКПД2 и единица в двух годах */
export interface AccuracyRepeat {
  subject: string; okpd2: string; region: string | null; unit: string; sameRegion: boolean;
  base: number; fact: number; manual: number | null; system: number;
}
export interface AccuracyYear {
  year: number;
  /** Прогноз с базой этого года: из него договоры года и НМЦ закупщиков */
  factFrom: { id: number; title: string } | null;
  /** Прогноз системы на этот год (база — прошлый год) */
  systemFrom: { id: number; title: string; growth: number } | null;
  /** Ручной прогноз по всем закупкам года */
  manual: {
    /** НМЦ из ГПЗ (план) или, если её нет в ГПЗ, из отчётности (на момент торгов) */
    source: "gpz" | "report" | null;
    n: number;
    /** Насколько НМЦ отличалась от цены договора: по сумме закупок, медиана по закупкам, типичное отклонение, % */
    bySum: number | null; median: number | null; typical: number | null;
    /** Доля закупок, где НМЦ отличалась от договора не больше чем на 10 % */
    within10: number | null;
    /** Закупок, где НМЦ и договор отличаются больше чем в 3 раза — в средние не входят */
    outliers: number;
    /** Запас на торги по категориям: медиана «НМЦ к договору − 1» по закупкам, % */
    byCat: { category: string; n: number; reserve: number }[];
    lots: AccuracyLot[];
  };
  /** Повторяющиеся закупки: ручной прогноз против системы на одних и тех же позициях */
  repeats: {
    n: number;
    /** Типичная ошибка (медиана |прогноз / факт − 1|), % */
    manualError: number | null; systemError: number | null;
    /** Рост цен к прошлому году, медиана по позициям, % */
    fact: number | null; manualGrowth: number | null; systemGrowth: number | null;
    /** Позиций, где система ближе к факту, чем закупщик */
    systemCloser: number; compared: number;
    rows: AccuracyRepeat[];
  };
}

/** Меньше стольких повторяющихся закупок — вывод о точности системы делать рано */
export const MIN_REPEATS = 5;
const STATUS_RANK: Record<string, number> = { approved: 0, review: 1, draft: 2, archived: 3, rejected: 4 };
const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);
const med = (xs: number[]) => (xs.length ? median(xs) : null);

async function itemsOf(versionId: number): Promise<StoredItem[]> {
  const rows = await sql().query(
    `SELECT item_key, okpd2, subject, category, region, unit, base_price, forecast_price, data FROM forecast_items WHERE version_id = $1`, [versionId]);
  return rows.map((r) => ({ ...r, base_price: Number(r.base_price), forecast_price: Number(r.forecast_price) })) as StoredItem[];
}

type D = { rawMedian?: number; unitLabel?: string; regionName?: string; pts?: PackedPoint[] };
const dataOf = (i: StoredItem) => i.data as StoredItem["data"] & D;
const contract = (i: StoredItem) => dataOf(i).rawMedian || i.base_price;
const unitOf = (i: StoredItem) => String(dataOf(i).unitLabel ?? i.unit).trim().toLowerCase();
const pointsOf = (i: StoredItem) => (dataOf(i).pts ?? []).map(unpackPoint);

/**
 * Ручной прогноз — НМЦ, которую закупщик заложил по лоту, против цены договора по этому же лоту.
 * Прогноз системы — цена договора прошлого года × индекс; проверяется на закупках, которые повторяются в двух годах.
 */
export async function accuracyByYear(): Promise<AccuracyYear[]> {
  const fs = await sql().query(`SELECT f.id, f.title, f.year, f.base_year, f.status, f.updated_at, f.current_version_id, v.stats
    FROM forecasts f JOIN forecast_versions v ON v.id = f.current_version_id`);
  const pick = (list: typeof fs) => list.filter((f) => f.status !== "rejected")
    .sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || +new Date(b.updated_at) - +new Date(a.updated_at))[0] ?? null;
  const years = [...new Set(fs.map((f) => Number(f.base_year)))].sort((a, b) => b - a);
  const out: AccuracyYear[] = [];
  for (const year of years) {
    const factF = pick(fs.filter((f) => Number(f.base_year) === year));
    if (!factF) continue;
    const sysF = pick(fs.filter((f) => Number(f.year) === year && Number(f.base_year) === year - 1));
    const factItems = await itemsOf(factF.current_version_id);

    // 1. Ручной прогноз по каждой закупке: НМЦ из ГПЗ, а если её там нет — из отчётности
    const all = factItems.flatMap((i) => pointsOf(i).map((p) => ({ i, p })));
    const source = all.some((x) => x.p.planNmc) ? "gpz" : all.some((x) => x.p.nmc) ? "report" : null;
    const lots: AccuracyLot[] = all.flatMap(({ i, p }) => {
      const plan = source === "gpz" ? p.planNmc : p.nmc;
      if (!plan || !p.raw) return [];
      const d = dataOf(i);
      return [{ subject: p.subject ?? i.subject, region: d.regionName ?? i.region, unit: d.unitLabel ?? i.unit, lot: p.lot, category: i.category ?? "Без категории", plan, fact: p.raw, dev: (plan / p.raw - 1) * 100,
        // НМЦ больше чем втрое выше договора (или ниже) — договор не на весь объём или ошибка в файле: в средние не берём
        outlier: plan / p.raw > 3 || plan / p.raw < 1 / 3, qty: p.qty ?? 1 }];
    });
    const ok = lots.filter((l) => !l.outlier);
    // По сумме — без выбросов
    const sumPlan = ok.reduce((s, l) => s + l.plan * l.qty, 0), sumFact = ok.reduce((s, l) => s + l.fact * l.qty, 0);

    // 2. Повторяющиеся закупки: позиция прогноза на этот год, которую закупали и в этом году (тот же код ОКПД2 и единица)
    const sysItems = sysF ? await itemsOf(sysF.current_version_id) : [];
    const byCode = new Map<string, StoredItem[]>();
    for (const i of factItems) { const k = `${i.okpd2}|${unitOf(i)}`; byCode.set(k, [...(byCode.get(k) ?? []), i]); }
    const planOf = (i: StoredItem) => med(pointsOf(i).map((p) => (source === "gpz" ? p.planNmc : p.nmc)).filter((v): v is number => !!v && v > 0));
    const rows: AccuracyRepeat[] = [];
    for (const s of sysItems) {
      const cands = byCode.get(`${s.okpd2}|${unitOf(s)}`);
      if (!cands) continue;
      // Сначала тот же регион; нет — медиана по регионам
      const same = cands.filter((c) => (c.region ?? "") === (s.region ?? ""));
      const use = same.length ? same : cands;
      const base = contract(s), fact = median(use.map(contract));
      // Цена отличается больше чем в 3 раза — под тем же кодом закупали другое, это не рост цен
      if (!base || fact / base > 3 || fact / base < 1 / 3) continue;
      const plans = use.map(planOf).filter((v): v is number => v != null);
      const d = dataOf(s);
      rows.push({ subject: s.subject, okpd2: s.okpd2, region: d.regionName ?? s.region, unit: d.unitLabel ?? s.unit, sameRegion: same.length > 0,
        base, fact, manual: plans.length ? median(plans) : null, system: s.forecast_price });
    }
    const cmp = rows.filter((r) => r.manual != null);
    const err = (p: number, f: number) => Math.abs(p / f - 1) * 100;
    out.push({
      year,
      factFrom: { id: factF.id, title: factF.title },
      systemFrom: sysF ? { id: sysF.id, title: sysF.title, growth: Number(sysF.stats?.growth ?? 0) } : null,
      manual: {
        source, n: lots.length,
        bySum: sumFact ? r1((sumPlan / sumFact - 1) * 100) : null,
        median: r1(med(ok.map((l) => l.dev))), typical: r1(med(ok.map((l) => Math.abs(l.dev)))),
        within10: ok.length ? Math.round((ok.filter((l) => Math.abs(l.dev) <= 10).length / ok.length) * 100) : null,
        outliers: lots.length - ok.length,
        byCat: [...new Set(lots.map((l) => l.category))].map((category) => {
          const xs = ok.filter((l) => l.category === category).map((l) => l.dev);
          if (!xs.length) return null;
          return { category, n: xs.length, reserve: r1(median(xs))! };
        }).filter((c): c is { category: string; n: number; reserve: number } => c != null).sort((a, b) => b.n - a.n),
        lots: lots.sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev)),
      },
      repeats: {
        n: rows.length,
        manualError: r1(med(cmp.map((r) => err(r.manual!, r.fact)))),
        systemError: r1(med((cmp.length ? cmp : rows).map((r) => err(r.system, r.fact)))),
        fact: r1(med(rows.map((r) => (r.fact / r.base - 1) * 100))),
        manualGrowth: r1(med(cmp.map((r) => (r.manual! / r.base - 1) * 100))),
        systemGrowth: r1(med(rows.map((r) => (r.system / r.base - 1) * 100))),
        systemCloser: cmp.filter((r) => err(r.system, r.fact) < err(r.manual!, r.fact)).length, compared: cmp.length,
        rows,
      },
    });
  }
  return out;
}

/**
 * Средний запас на торги по годам до upTo включительно: насколько НМЦ в ГПЗ выше цены договора.
 * По категориям — среднее медиан по годам; общий — медиана по всем закупкам, чтобы единичные выбросы не искажали цифру.
 */
export async function tenderReserve(upTo: number) {
  const ys = (await accuracyByYear()).filter((y) => y.year <= upTo && y.manual.n > 0);
  const cats = new Map<string, { n: number; sum: number; years: number }>();
  for (const y of ys) for (const c of y.manual.byCat) {
    const e = cats.get(c.category) ?? { n: 0, sum: 0, years: 0 };
    e.n += c.n; e.sum += c.reserve; e.years++; cats.set(c.category, e);
  }
  const all = ys.flatMap((y) => y.manual.lots.filter((l) => !l.outlier).map((l) => l.dev));
  return {
    years: ys.map((y) => y.year).sort(),
    overall: all.length ? r1(median(all)) : null,
    byCat: Object.fromEntries([...cats].map(([k, e]) => [k, { n: e.n, reserve: r1(e.sum / e.years) }])) as Record<string, { n: number; reserve: number }>,
  };
}
