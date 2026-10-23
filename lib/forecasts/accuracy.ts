import { sql } from "../db";
import { median } from "../forecast";
import type { StoredItem } from "./model";

/** Позиция: цена договоров прошлого года, факт года, НМЦ закупщика и прогноз системы — за единицу без НДС */
export interface AccuracyRow {
  subject: string; region: string | null; unit: string; okpd2: string;
  base: number; fact: number; manual: number | null; system: number;
  /** Как найден факт: та же позиция; тот же код, единица и регион; тот же код и единица в другом регионе */
  match: "exact" | "region" | "code";
}
export interface AccuracyYear {
  year: number;
  /** Прогноз системы на год (база — прошлый год): из него цена прошлого года и прогноз */
  systemFrom: { id: number; title: string; growth: number; items: number } | null;
  /** Прогноз с базой этого года: из него факт (договоры года) и НМЦ закупщиков */
  factFrom: { id: number; title: string } | null;
  /** Рост цен к прошлому году, %, на сопоставленных позициях */
  fact: number | null;
  system: number | null;
  /** Ручной прогноз считается только по позициям с НМЦ — факт на том же наборе */
  manual: number | null;
  factManual: number | null;
  nManual: number;
  matched: { exact: number; region: number; code: number };
  rows: AccuracyRow[];
}

const STATUS_RANK: Record<string, number> = { approved: 0, review: 1, draft: 2, archived: 3, rejected: 4 };
const r1 = (x: number) => Math.round(x * 10) / 10;
/** Рост так же, как в карточке прогноза: сумма цен за единицу к сумме цен прошлого года */
const growth = (xs: number[], base: number[]) => { const b = base.reduce((s, x) => s + x, 0); return b ? r1((xs.reduce((s, x) => s + x, 0) / b - 1) * 100) : null; };

async function itemsOf(versionId: number): Promise<StoredItem[]> {
  const rows = await sql().query(
    `SELECT item_key, okpd2, subject, region, unit, base_price, forecast_price, data - 'pts' AS data FROM forecast_items WHERE version_id = $1`, [versionId]);
  return rows.map((r) => ({ ...r, base_price: Number(r.base_price), forecast_price: Number(r.forecast_price) })) as StoredItem[];
}

type D = { rawMedian?: number; nmcMedian?: number | null; unitLabel?: string; regionName?: string };
const dataOf = (i: StoredItem) => i.data as StoredItem["data"] & D;
/** Цена договоров года по позиции — медиана без пересчёта внутри года */
const contract = (i: StoredItem) => dataOf(i).rawMedian || i.base_price;
const unitOf = (i: StoredItem) => String(dataOf(i).unitLabel ?? i.unit).trim().toLowerCase();

/**
 * По каждому году Y: на сколько выросли цены договоров Y к Y−1 (факт), сколько заложили закупщики (НМЦ в ГПЗ Y)
 * и сколько предсказала система (прогноз на Y по отчётности Y−1). Сравниваем на позициях, которые есть в обоих годах.
 */
export async function accuracyByYear(): Promise<AccuracyYear[]> {
  const fs = await sql().query(`SELECT f.id, f.title, f.year, f.base_year, f.status, f.updated_at, f.current_version_id, v.stats
    FROM forecasts f JOIN forecast_versions v ON v.id = f.current_version_id`);
  const pick = (list: typeof fs) => list.filter((f) => f.status !== "rejected")
    .sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || +new Date(b.updated_at) - +new Date(a.updated_at))[0] ?? null;
  const years = [...new Set(fs.flatMap((f) => [Number(f.base_year), Number(f.year)]))].sort((a, b) => b - a);
  const out: AccuracyYear[] = [];
  for (const year of years) {
    const sysF = pick(fs.filter((f) => Number(f.year) === year && Number(f.base_year) === year - 1));
    const factF = pick(fs.filter((f) => Number(f.base_year) === year));
    if (!sysF && !factF) continue;
    const sysItems = sysF ? await itemsOf(sysF.current_version_id) : [];
    const factItems = factF ? await itemsOf(factF.current_version_id) : [];
    // Факт ищем по ключу позиции; код вида закупки (WS) между годами часто меняется — тогда по ОКПД2, единице и региону,
    // а если такого региона нет — по ОКПД2 и единице (медиана по регионам)
    const byKey = new Map(factItems.map((i) => [i.item_key, i]));
    const group = (f: (i: StoredItem) => string) => {
      const m = new Map<string, StoredItem[]>();
      for (const i of factItems) m.set(f(i), [...(m.get(f(i)) ?? []), i]);
      return m;
    };
    const byRegion = group((i) => `${i.okpd2}|${unitOf(i)}|${i.region ?? ""}`);
    const byCode = group((i) => `${i.okpd2}|${unitOf(i)}`);
    const pool = (xs: StoredItem[]) => ({ fact: median(xs.map(contract)), manual: (() => { const m = xs.map((x) => dataOf(x).nmcMedian).filter((v): v is number => !!v && v > 0); return m.length ? median(m) : null; })() });
    const rows: AccuracyRow[] = [];
    for (const i of sysItems) {
      const base = contract(i);
      const ex = byKey.get(i.item_key);
      const reg = byRegion.get(`${i.okpd2}|${unitOf(i)}|${i.region ?? ""}`);
      const code = byCode.get(`${i.okpd2}|${unitOf(i)}`);
      const [m, match] = ex ? [pool([ex]), "exact" as const] : reg ? [pool(reg), "region" as const] : code ? [pool(code), "code" as const] : [null, null];
      // Разница больше чем в 10 раз — это другая единица или другой товар, а не рост цен
      if (!m || !match || !base || m.fact / base > 10 || m.fact / base < 0.1) continue;
      const d = dataOf(i);
      rows.push({ subject: i.subject, okpd2: i.okpd2, region: d.regionName ?? i.region, unit: d.unitLabel ?? i.unit, base, fact: m.fact, manual: m.manual, system: i.forecast_price, match });
    }
    const wm = rows.filter((r) => r.manual != null);
    out.push({
      year,
      systemFrom: sysF ? { id: sysF.id, title: sysF.title, growth: Number(sysF.stats?.growth ?? 0), items: sysItems.length } : null,
      factFrom: factF ? { id: factF.id, title: factF.title } : null,
      fact: growth(rows.map((r) => r.fact), rows.map((r) => r.base)),
      system: growth(rows.map((r) => r.system), rows.map((r) => r.base)),
      manual: growth(wm.map((r) => r.manual!), wm.map((r) => r.base)),
      factManual: growth(wm.map((r) => r.fact), wm.map((r) => r.base)),
      nManual: wm.length,
      matched: { exact: rows.filter((r) => r.match === "exact").length, region: rows.filter((r) => r.match === "region").length, code: rows.filter((r) => r.match === "code").length },
      rows,
    });
  }
  return out;
}
