import { sql } from "../db";
import { median } from "../forecast";
import type { StoredItem } from "./model";

/** Строка сравнения: факт года, ручная цена из плана (НМЦ) и прогноз системы — за единицу без НДС */
export interface AccuracyRow { subject: string; region: string | null; unit: string; okpd2: string; fact: number; manual: number | null; system: number | null }
export interface AccuracyStat { n: number; error: number | null; bias: number | null }
export interface AccuracyYear {
  year: number;
  /** Прогноз с базой этого года: из него ручная цена (НМЦ плана) и факт (договоры года) */
  factFrom: { id: number; title: string } | null;
  /** Прогноз системы на этот год (база — прошлый год) */
  systemFrom: { id: number; title: string } | null;
  /** Сравнение на одних и тех же позициях — там, где есть все три цены */
  both: { n: number; manual: AccuracyStat; system: AccuracyStat } | null;
  manual: AccuracyStat;
  system: AccuracyStat;
  rows: AccuracyRow[];
}

const STATUS_RANK: Record<string, number> = { approved: 0, review: 1, draft: 2, archived: 3, rejected: 4 };
const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);

/** Типичная ошибка — медиана |прогноз / факт − 1|; смещение — медиана (прогноз / факт − 1): плюс — прогноз выше факта */
function stat(pairs: { pred: number; fact: number }[]): AccuracyStat {
  const d = pairs.filter((p) => p.fact > 0).map((p) => (p.pred / p.fact - 1) * 100);
  return { n: d.length, error: d.length ? r1(median(d.map(Math.abs))) : null, bias: d.length ? r1(median(d)) : null };
}

async function itemsOf(versionId: number): Promise<StoredItem[]> {
  const rows = await sql().query(
    `SELECT item_key, okpd2, subject, region, unit, base_price, forecast_price, data - 'pts' AS data FROM forecast_items WHERE version_id = $1`, [versionId]);
  return rows.map((r) => ({ ...r, base_price: Number(r.base_price), forecast_price: Number(r.forecast_price) })) as StoredItem[];
}

/** По каждому году: насколько ручная цена из ГПЗ и прогноз системы совпали с ценами договоров этого года */
export async function accuracyByYear(): Promise<AccuracyYear[]> {
  const fs = await sql().query(`SELECT f.id, f.title, f.year, f.base_year, f.status, f.updated_at, f.current_version_id FROM forecasts f`);
  // На каждый год — лучший прогноз: утверждённый, затем на проверке, в работе; при равенстве — свежий
  const pick = (list: typeof fs) => list.sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || +new Date(b.updated_at) - +new Date(a.updated_at))[0] ?? null;
  const years = [...new Set(fs.map((f) => Number(f.base_year)))].sort((a, b) => b - a);
  const out: AccuracyYear[] = [];
  for (const year of years) {
    const factF = pick(fs.filter((f) => Number(f.base_year) === year && f.status !== "rejected"));
    if (!factF) continue;
    const sysF = pick(fs.filter((f) => Number(f.year) === year && f.status !== "rejected"));
    const facts = await itemsOf(factF.current_version_id);
    const sys = sysF ? new Map((await itemsOf(sysF.current_version_id)).map((i) => [i.item_key, i.forecast_price])) : new Map<string, number>();
    const rows: AccuracyRow[] = facts.map((i) => {
      const d = i.data as StoredItem["data"] & { rawMedian?: number; nmcMedian?: number | null; unitLabel?: string; regionName?: string };
      return {
        subject: i.subject, okpd2: i.okpd2, region: d.regionName ?? i.region, unit: d.unitLabel ?? i.unit,
        fact: d.rawMedian || i.base_price, manual: d.nmcMedian && d.nmcMedian > 0 ? d.nmcMedian : null, system: sys.get(i.item_key) ?? null,
      };
    });
    const all3 = rows.filter((r) => r.manual != null && r.system != null);
    out.push({
      year,
      factFrom: { id: factF.id, title: factF.title },
      systemFrom: sysF ? { id: sysF.id, title: sysF.title } : null,
      both: all3.length ? {
        n: all3.length,
        manual: stat(all3.map((r) => ({ pred: r.manual!, fact: r.fact }))),
        system: stat(all3.map((r) => ({ pred: r.system!, fact: r.fact }))),
      } : null,
      manual: stat(rows.filter((r) => r.manual != null).map((r) => ({ pred: r.manual!, fact: r.fact }))),
      system: stat(rows.filter((r) => r.system != null).map((r) => ({ pred: r.system!, fact: r.fact }))),
      rows: rows.filter((r) => r.manual != null || r.system != null),
    });
  }
  return out;
}
