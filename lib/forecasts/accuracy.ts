import { listTable, sql } from "../db";
import { median } from "../forecast";
import type { StoredItem } from "./model";

/**
 * Вид продукции — первые две ступени кода ОКПД2 (19.20 — нефтепродукты) и единица.
 * Цены — медианы за единицу без НДС по всем позициям вида в году.
 */
export interface AccuracyGroup {
  code: string; name: string; unit: string;
  /** Позиций вида: в прошлом году (прогноз системы) и в этом (факт) */
  nBase: number; nFact: number;
  base: number; fact: number; manual: number | null; system: number;
  /** Рост к прошлому году, % */
  gFact: number; gManual: number | null; gSystem: number;
}
export interface AccuracyYear {
  year: number;
  /** Прогноз системы на год (база — прошлый год): из него цены прошлого года и прогноз */
  systemFrom: { id: number; title: string; growth: number; items: number } | null;
  /** Прогноз с базой этого года: из него факт (договоры года) и НМЦ закупщиков */
  factFrom: { id: number; title: string; items: number } | null;
  /** Рост по всем сопоставленным видам, %: виды взвешены суммой цен прошлого года, как в карточке прогноза */
  fact: number | null; system: number | null;
  /** Ручной — по видам, где есть НМЦ; факт на том же наборе */
  manual: number | null; factManual: number | null;
  /** Виды: только в прошлом году, только в этом, общие */
  kinds: { base: number; fact: number; common: number };
  groups: AccuracyGroup[];
}

const STATUS_RANK: Record<string, number> = { approved: 0, review: 1, draft: 2, archived: 3, rejected: 4 };
const r1 = (x: number) => Math.round(x * 10) / 10;
const pct = (p: number, b: number) => r1((p / b - 1) * 100);

async function itemsOf(versionId: number): Promise<StoredItem[]> {
  const rows = await sql().query(
    `SELECT item_key, okpd2, subject, region, unit, base_price, forecast_price, data - 'pts' AS data FROM forecast_items WHERE version_id = $1`, [versionId]);
  return rows.map((r) => ({ ...r, base_price: Number(r.base_price), forecast_price: Number(r.forecast_price) })) as StoredItem[];
}

type D = { rawMedian?: number; nmcMedian?: number | null; unitLabel?: string };
const dataOf = (i: StoredItem) => i.data as StoredItem["data"] & D;
/** Цена договоров года по позиции — медиана без пересчёта внутри года */
const contract = (i: StoredItem) => dataOf(i).rawMedian || i.base_price;
const unitOf = (i: StoredItem) => String(dataOf(i).unitLabel ?? i.unit).trim().toLowerCase();
const kindOf = (okpd2: string) => okpd2.split(".").slice(0, 2).join(".");

/** Сводный рост по видам: взвешиваем суммой цен прошлого года */
function total(gs: { base: number; nBase: number; g: number }[]) {
  const w = gs.reduce((s, x) => s + x.base * x.nBase, 0);
  return w ? r1(gs.reduce((s, x) => s + x.base * x.nBase * x.g, 0) / w) : null;
}

/**
 * По каждому году Y: на сколько выросли цены договоров Y к Y−1 (факт), сколько заложили закупщики (НМЦ в ГПЗ Y)
 * и сколько предсказала система (прогноз на Y по отчётности Y−1). Сравниваем по видам продукции, которые есть в обоих годах.
 */
export async function accuracyByYear(): Promise<AccuracyYear[]> {
  const fs = await sql().query(`SELECT f.id, f.title, f.year, f.base_year, f.status, f.updated_at, f.current_version_id, v.stats
    FROM forecasts f JOIN forecast_versions v ON v.id = f.current_version_id`);
  const names = new Map((await listTable("okpd2")).map((o) => [String(o.code), String(o.name)]));
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
    const byKind = (xs: StoredItem[]) => {
      const m = new Map<string, StoredItem[]>();
      for (const i of xs) { const k = `${kindOf(i.okpd2)}|${unitOf(i)}`; m.set(k, [...(m.get(k) ?? []), i]); }
      return m;
    };
    const B = byKind(sysItems), F = byKind(factItems);
    const groups: AccuracyGroup[] = [];
    for (const [k, bs] of B) {
      const fx = F.get(k);
      if (!fx) continue;
      const base = median(bs.map(contract)), fact = median(fx.map(contract)), system = median(bs.map((i) => i.forecast_price));
      // Разница больше чем в 10 раз — внутри вида закупали разное, сравнивать нельзя
      if (!base || fact / base > 10 || fact / base < 0.1) continue;
      const nmc = fx.map((i) => dataOf(i).nmcMedian).filter((v): v is number => !!v && v > 0);
      const manual = nmc.length ? median(nmc) : null;
      const [code, unit] = k.split("|");
      groups.push({
        code, unit: dataOf(bs[0]).unitLabel ?? unit, name: names.get(code) ?? bs[0].subject,
        nBase: bs.length, nFact: fx.length, base, fact, manual, system,
        gFact: pct(fact, base), gManual: manual != null ? pct(manual, base) : null, gSystem: pct(system, base),
      });
    }
    const wm = groups.filter((g) => g.gManual != null);
    out.push({
      year,
      systemFrom: sysF ? { id: sysF.id, title: sysF.title, growth: Number(sysF.stats?.growth ?? 0), items: sysItems.length } : null,
      factFrom: factF ? { id: factF.id, title: factF.title, items: factItems.length } : null,
      fact: total(groups.map((g) => ({ ...g, g: g.gFact }))),
      system: total(groups.map((g) => ({ ...g, g: g.gSystem }))),
      manual: total(wm.map((g) => ({ ...g, g: g.gManual! }))),
      factManual: total(wm.map((g) => ({ ...g, g: g.gFact }))),
      kinds: { base: B.size, fact: F.size, common: groups.length },
      groups: groups.sort((a, b) => b.base * b.nBase - a.base * a.nBase),
    });
  }
  return out;
}
