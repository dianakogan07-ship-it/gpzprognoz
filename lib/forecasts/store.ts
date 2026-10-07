import { ensureDemo, loadReference, sql } from "../db";
import type { Reference } from "../types";
import { aggregateForecast, groupKey, type ContractPoint, type ForecastRow } from "../forecast";
import {
  canTransition, fingerprint, hasNewIndices, indexSnapshot, isFrozen, mape, refFromSnapshot, statsOf,
  type ForecastStatus, type SnapshotIndex, type StoredItem, type VersionStats,
} from "./model";

export const currentAuthor = () => process.env.BASIC_AUTH_USER || "owner";

const num = (v: unknown) => (v == null ? null : Number(v));

export interface ForecastCard {
  id: number;
  title: string;
  year: number;
  base_year: number;
  status: ForecastStatus;
  version: number;
  version_id: number;
  updated_at: string;
  stats: VersionStats;
  newIndices: boolean;
  accuracy: number | null;
  actualRows: number;
}

/** Плашки: только сам прогноз, агрегаты текущей версии и точность по факту — без строк */
export async function listForecasts(): Promise<ForecastCard[]> {
  await ensureDemo();
  const db = sql();
  const rows = await db.query(`
    SELECT f.id, f.title, f.year, f.base_year, f.status, f.updated_at, v.id AS version_id, v.number AS version, v.stats, v.index_snapshot,
      (SELECT count(*) FROM actuals a WHERE a.forecast_id = f.id) AS actual_rows,
      (SELECT avg(abs(i.forecast_price - a.actual_price) / NULLIF(a.actual_price, 0))
         FROM actuals a JOIN forecast_items i ON i.version_id = f.current_version_id AND i.item_key = a.item_key
        WHERE a.forecast_id = f.id) AS mape
    FROM forecasts f JOIN forecast_versions v ON v.id = f.current_version_id`);
  const ref = await loadReference();
  return rows.map((r) => {
    const m = num(r.mape);
    return {
      id: r.id, title: r.title, year: r.year, base_year: r.base_year, status: r.status, version: r.version, version_id: r.version_id,
      updated_at: new Date(r.updated_at).toISOString(), stats: r.stats,
      newIndices: r.status !== "archived" && hasNewIndices(indexSnapshot(ref, r.year, r.base_year), r.index_snapshot ?? []),
      accuracy: m == null ? null : Math.max(0, Math.round((100 - m * 100) * 10) / 10),
      actualRows: Number(r.actual_rows),
    };
  });
}

async function log(e: { forecastId: number; versionId?: number | null; itemId?: number | null; okpd2?: string | null; type: string; field?: string; oldValue?: unknown; newValue?: unknown; reason?: string | null; author: string }) {
  await sql().query(
    `INSERT INTO change_log (forecast_id, version_id, item_id, okpd2, event_type, field, old_value, new_value, reason, author) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [e.forecastId, e.versionId ?? null, e.itemId ?? null, e.okpd2 ?? null, e.type, e.field ?? null,
      e.oldValue == null ? null : String(e.oldValue), e.newValue == null ? null : String(e.newValue), e.reason ?? null, e.author],
  );
}

/** Строки прогноза → записи хранилища. Договоры храним коротко: [цена, месяц] — для пересчёта */
function itemRecords(rows: ForecastRow[]) {
  return rows.map((r) => ({
    item_key: groupKey(r), okpd2: r.okpd2, subject: r.subject, category: r.category, method: r.method ?? null, region: r.region,
    unit: r.unit, contracts: r.contracts, base_price: r.basePrice, index_value: r.forecastIndex, index_source: r.indexSource || null,
    forecast_price: r.forecastPrice, needs_review: r.needsApproval, reviewed: false, manually_edited: false,
    data: { ...r, points: undefined, pts: (r.points ?? []).map((p) => [p.raw, p.month]) },
  }));
}

async function insertItems(versionId: number, rows: ForecastRow[]) {
  const recs = itemRecords(rows);
  for (let i = 0; i < recs.length; i += 500) {
    await sql().query(
      `INSERT INTO forecast_items (version_id, item_key, okpd2, subject, category, method, region, unit, contracts, base_price, index_value, index_source, forecast_price, needs_review, reviewed, manually_edited, data)
       SELECT $1, x.item_key, x.okpd2, x.subject, x.category, x.method, x.region, x.unit, x.contracts, x.base_price, x.index_value, x.index_source, x.forecast_price, x.needs_review, x.reviewed, x.manually_edited, x.data
       FROM jsonb_to_recordset($2::jsonb) AS x(item_key text, okpd2 text, subject text, category text, method text, region text, unit text, contracts int,
         base_price numeric, index_value numeric, index_source text, forecast_price numeric, needs_review boolean, reviewed boolean, manually_edited boolean, data jsonb)`,
      [versionId, JSON.stringify(recs.slice(i, i + 500))],
    );
  }
}

async function refreshStats(versionId: number, excluded?: number) {
  const db = sql();
  const items = await db.query("SELECT base_price, forecast_price, contracts, needs_review, reviewed, manually_edited FROM forecast_items WHERE version_id = $1", [versionId]);
  const [v] = await db.query("SELECT stats FROM forecast_versions WHERE id = $1", [versionId]);
  const stats = statsOf(items as never, excluded ?? v?.stats?.excluded ?? 0);
  await db.query("UPDATE forecast_versions SET stats = $1 WHERE id = $2", [JSON.stringify(stats), versionId]);
  return stats;
}

const touch = (id: number) => sql().query("UPDATE forecasts SET updated_at = now() WHERE id = $1", [id]);

/** Новый прогноз: черновик v1 со снимком индексов. Строки догружаются частями */
export async function createForecast(p: { title: string; year: number; baseYear: number; author: string }, refOverride?: Reference) {
  const db = sql();
  const ref = refOverride ?? (await loadReference());
  const snap = indexSnapshot(ref, p.year, p.baseYear);
  const [f] = await db.query("INSERT INTO forecasts (title, year, base_year, author) VALUES ($1,$2,$3,$4) RETURNING id", [p.title, p.year, p.baseYear, p.author]);
  const [v] = await db.query(
    "INSERT INTO forecast_versions (forecast_id, number, comment, index_snapshot, index_fingerprint, author) VALUES ($1, 1, $2, $3, $4, $5) RETURNING id",
    [f.id, "Первый расчёт", JSON.stringify(snap), fingerprint(snap), p.author],
  );
  await db.query("UPDATE forecasts SET current_version_id = $1 WHERE id = $2", [v.id, f.id]);
  return { id: f.id as number, versionId: v.id as number };
}

/** Догрузка строк в черновик, который ещё не завершён */
export async function appendItems(forecastId: number, versionId: number, rows: ForecastRow[]) {
  const [v] = await sql().query("SELECT v.status FROM forecast_versions v WHERE v.id = $1 AND v.forecast_id = $2", [versionId, forecastId]);
  if (!v) throw new Error("Версия не найдена");
  if (isFrozen(v.status)) throw new Error("Версия утверждена и не меняется");
  await insertItems(versionId, rows);
}

export async function finalizeUpload(forecastId: number, versionId: number, info: { gpzRows: number; excluded: number; author: string }) {
  const stats = await refreshStats(versionId, info.excluded);
  await log({ forecastId, versionId, type: "upload", newValue: `строк ГПЗ: ${info.gpzRows}, не вошли: ${info.excluded}`, author: info.author });
  await log({ forecastId, versionId, type: "calc", newValue: `позиций: ${stats.items}, договоров: ${stats.contracts}`, author: info.author });
  return stats;
}

export async function getForecast(id: number, versionId?: number) {
  const db = sql();
  const [f] = await db.query("SELECT * FROM forecasts WHERE id = $1", [id]);
  if (!f) throw new Error("Прогноз не найден");
  const versions = await db.query("SELECT id, number, status, comment, stats, author, created_at, index_snapshot FROM forecast_versions WHERE forecast_id = $1 ORDER BY number DESC", [id]);
  const ref = await loadReference();
  const cur = versions.find((v) => v.id === f.current_version_id);
  const shown = versions.find((v) => v.id === versionId) ?? cur;
  return {
    ...f,
    versions: versions.map((v) => ({ ...v, index_snapshot: undefined, indices: (v.index_snapshot as SnapshotIndex[]).length })),
    /** Индексы показываемой версии */
    snapshot: (shown?.index_snapshot ?? []) as SnapshotIndex[],
    newIndices: f.status !== "archived" && cur != null && hasNewIndices(indexSnapshot(ref, f.year, f.base_year), cur.index_snapshot),
  };
}

/** Строки версии без списка договоров — для таблицы */
export async function getItems(versionId: number): Promise<StoredItem[]> {
  const rows = await sql().query(
    `SELECT id, item_key, okpd2, subject, category, method, region, unit, contracts, base_price, index_value, index_source, forecast_price,
            needs_review, reviewed, manually_edited, data - 'pts' AS data
       FROM forecast_items WHERE version_id = $1 ORDER BY okpd2, unit, id`, [versionId]);
  return rows.map((r) => ({ ...r, base_price: Number(r.base_price), index_value: Number(r.index_value), forecast_price: Number(r.forecast_price) })) as StoredItem[];
}

async function forecastOf(id: number) {
  const [f] = await sql().query("SELECT f.*, v.status AS version_status, v.number FROM forecasts f JOIN forecast_versions v ON v.id = f.current_version_id WHERE f.id = $1", [id]);
  if (!f) throw new Error("Прогноз не найден");
  return f as { id: number; status: ForecastStatus; version_status: ForecastStatus; current_version_id: number; number: number; year: number; base_year: number };
}

/** Новая версия — копия текущей. Утверждённая версия остаётся как была */
export async function newVersion(forecastId: number, comment: string, author: string, rows?: ForecastRow[], snap?: SnapshotIndex[]) {
  const db = sql();
  const f = await forecastOf(forecastId);
  if (f.status === "archived") throw new Error("Прогноз в архиве");
  const [prev] = await db.query("SELECT index_snapshot, index_fingerprint, stats FROM forecast_versions WHERE id = $1", [f.current_version_id]);
  const [v] = await db.query(
    "INSERT INTO forecast_versions (forecast_id, number, comment, index_snapshot, index_fingerprint, stats, author) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, number",
    [forecastId, f.number + 1, comment, JSON.stringify(snap ?? prev.index_snapshot), snap ? fingerprint(snap) : prev.index_fingerprint, JSON.stringify(prev.stats), author],
  );
  if (rows) await insertItems(v.id, rows);
  else {
    await db.query(
      `INSERT INTO forecast_items (version_id, item_key, okpd2, subject, category, method, region, unit, contracts, base_price, index_value, index_source, forecast_price, needs_review, reviewed, manually_edited, data)
       SELECT $1, item_key, okpd2, subject, category, method, region, unit, contracts, base_price, index_value, index_source, forecast_price, needs_review, reviewed, manually_edited, data
       FROM forecast_items WHERE version_id = $2`, [v.id, f.current_version_id]);
  }
  await db.query("UPDATE forecasts SET current_version_id = $1, status = 'draft', updated_at = now() WHERE id = $2", [v.id, forecastId]);
  await refreshStats(v.id);
  await log({ forecastId, versionId: v.id, type: "version", newValue: `v${v.number}`, reason: comment, author });
  return { versionId: v.id as number, number: v.number as number };
}

export type EditField = "forecast_price" | "index_value" | "reviewed";

/** Ручная правка строки. Без причины не сохраняется. Утверждённая версия не меняется — создаётся новая */
export async function editItem(forecastId: number, itemId: number, field: EditField, value: number | boolean, reason: string, author: string) {
  if (!reason?.trim()) throw new Error("Укажите причину правки");
  if (!["forecast_price", "index_value", "reviewed"].includes(field)) throw new Error("Это поле нельзя изменить");
  const db = sql();
  let f = await forecastOf(forecastId);
  if (f.status === "archived") throw new Error("Прогноз в архиве — изменения невозможны");
  const [src] = await db.query("SELECT * FROM forecast_items WHERE id = $1", [itemId]);
  if (!src) throw new Error("Строка не найдена");
  let created: { versionId: number; number: number } | null = null;
  if (isFrozen(f.version_status)) {
    created = await newVersion(forecastId, `Правка утверждённой версии: ${reason.trim()}`, author);
    f = await forecastOf(forecastId);
  } else if (src.version_id !== f.current_version_id) throw new Error("Строка относится к другой версии");
  const [item] = await db.query("SELECT * FROM forecast_items WHERE version_id = $1 AND item_key = $2", [f.current_version_id, src.item_key]);
  const base = Number(item.base_price);
  let set: Record<string, unknown>;
  let oldValue: unknown, newValue: unknown;
  if (field === "reviewed") {
    set = { reviewed: Boolean(value) };
    oldValue = item.reviewed ? "да" : "нет"; newValue = value ? "да" : "нет";
  } else {
    const v = Number(value);
    if (!(v > 0)) throw new Error("Значение должно быть больше нуля");
    const index = field === "index_value" ? v : Math.round((v / base) * 100000) / 100000;
    const price = field === "forecast_price" ? v : Math.round(base * v * 100) / 100;
    set = { index_value: index, forecast_price: price, manually_edited: true };
    oldValue = field === "index_value" ? Number(item.index_value) : Number(item.forecast_price);
    newValue = v;
  }
  const keys = Object.keys(set);
  await db.query(`UPDATE forecast_items SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(", ")} WHERE id = $${keys.length + 1}`, [...Object.values(set), item.id]);
  const stats = await refreshStats(f.current_version_id);
  await log({ forecastId, versionId: f.current_version_id, itemId: item.id, okpd2: item.okpd2, type: field === "reviewed" ? "review" : "edit", field, oldValue, newValue, reason: reason.trim(), author });
  await touch(forecastId);
  return { itemId: item.id as number, newVersion: created, stats };
}

export async function setStatus(forecastId: number, to: ForecastStatus, author: string, reason?: string) {
  const f = await forecastOf(forecastId);
  if (!canTransition(f.status, to)) throw new Error("Такой переход статуса невозможен");
  const db = sql();
  await db.query("UPDATE forecasts SET status = $1, updated_at = now() WHERE id = $2", [to, forecastId]);
  await db.query("UPDATE forecast_versions SET status = $1 WHERE id = $2", [to, f.current_version_id]);
  await log({ forecastId, versionId: f.current_version_id, type: "status", field: "status", oldValue: f.status, newValue: to, reason: reason ?? null, author });
}

/** Пересчёт по действующим индексам — новая версия. Ручные правки не переносятся */
export async function recalc(forecastId: number, author: string) {
  const db = sql();
  const f = await forecastOf(forecastId);
  const ref = await loadReference();
  const items = await db.query("SELECT okpd2, unit, region, category, method, subject, data FROM forecast_items WHERE version_id = $1", [f.current_version_id]);
  const points: ContractPoint[] = items.flatMap((i) => ((i.data.pts ?? []) as [number, number | null][]).map(([raw, month]) => ({
    okpd2: i.okpd2, unit: i.unit, region: i.region, ws: i.data.ws ?? null, category: i.category, method: i.method, subject: i.subject, raw, month,
  })));
  const rows = aggregateForecast(points, ref, { baseYear: f.base_year, targetYear: f.year });
  const snap = indexSnapshot(ref, f.year, f.base_year);
  const edited = (await db.query("SELECT count(*) AS n FROM forecast_items WHERE version_id = $1 AND manually_edited", [f.current_version_id]))[0].n;
  const comment = `Пересчёт по новым индексам${Number(edited) ? ` (ручные правки ${edited} строк не перенесены)` : ""}`;
  const v = await newVersion(forecastId, comment, author, rows, snap);
  await log({ forecastId, versionId: v.versionId, type: "recalc", newValue: `v${v.number}`, reason: comment, author });
  return v;
}

/** Воспроизведение версии: пересчёт её договоров по снимку индексов этой версии */
export async function reproduce(versionId: number) {
  const db = sql();
  const [v] = await db.query("SELECT v.index_snapshot, f.year, f.base_year FROM forecast_versions v JOIN forecasts f ON f.id = v.forecast_id WHERE v.id = $1", [versionId]);
  const ref = refFromSnapshot(await loadReference(), v.index_snapshot);
  const items = await db.query("SELECT okpd2, unit, region, category, method, subject, data FROM forecast_items WHERE version_id = $1", [versionId]);
  const points: ContractPoint[] = items.flatMap((i) => ((i.data.pts ?? []) as [number, number | null][]).map(([raw, month]) => ({
    okpd2: i.okpd2, unit: i.unit, region: i.region, ws: i.data.ws ?? null, category: i.category, method: i.method, subject: i.subject, raw, month,
  })));
  return aggregateForecast(points, ref, { baseYear: v.base_year, targetYear: v.year });
}

export async function history(forecastId: number) {
  const db = sql();
  const versions = await db.query("SELECT id, number, status, comment, stats, author, created_at FROM forecast_versions WHERE forecast_id = $1 ORDER BY number DESC", [forecastId]);
  const events = await db.query(
    `SELECT l.id, l.version_id, v.number AS version, l.item_id, l.okpd2, i.subject, l.event_type, l.field, l.old_value, l.new_value, l.reason, l.author, l.created_at
       FROM change_log l LEFT JOIN forecast_versions v ON v.id = l.version_id LEFT JOIN forecast_items i ON i.id = l.item_id
      WHERE l.forecast_id = $1 ORDER BY l.created_at DESC, l.id DESC LIMIT 2000`, [forecastId]);
  return { versions, events };
}

export interface CompareRow { key: string; okpd2: string; subject: string; unit: string; region: string | null; category: string | null; a: number | null; b: number | null; delta: number | null; deltaPct: number | null }

/** Сравнение двух версий (одного прогноза или прогнозов разных лет) по одинаковым позициям */
export async function compareVersions(aId: number, bId: number, onlyChanged: boolean, byOkpdOnly = false) {
  const [a, b] = await Promise.all([getItems(aId), getItems(bId)]);
  const keyOf = (i: StoredItem) => (byOkpdOnly ? [i.okpd2, i.unit, i.region ?? ""].join("|") : i.item_key);
  const map = new Map<string, CompareRow>();
  for (const i of a) map.set(keyOf(i), { key: keyOf(i), okpd2: i.okpd2, subject: i.subject, unit: i.data.unitLabel ?? i.unit, region: i.data.regionName ?? i.region, category: i.category, a: i.forecast_price, b: null, delta: null, deltaPct: null });
  for (const i of b) {
    const r = map.get(keyOf(i)) ?? { key: keyOf(i), okpd2: i.okpd2, subject: i.subject, unit: i.data.unitLabel ?? i.unit, region: i.data.regionName ?? i.region, category: i.category, a: null, b: null, delta: null, deltaPct: null };
    r.b = i.forecast_price;
    map.set(keyOf(i), r);
  }
  const rows = [...map.values()].map((r) => ({
    ...r,
    delta: r.a != null && r.b != null ? Math.round((r.b - r.a) * 100) / 100 : null,
    deltaPct: r.a && r.b != null ? Math.round((r.b / r.a - 1) * 1000) / 10 : null,
  }));
  const changed = rows.filter((r) => r.a == null || r.b == null || Math.abs(r.delta ?? 0) >= 0.005);
  const both = rows.filter((r) => r.a != null && r.b != null);
  const sumA = both.reduce((s, r) => s + r.a!, 0), sumB = both.reduce((s, r) => s + r.b!, 0);
  return {
    rows: (onlyChanged ? changed : rows).sort((x, y) => Math.abs(y.deltaPct ?? 999) - Math.abs(x.deltaPct ?? 999)),
    total: { common: both.length, changed: both.filter((r) => Math.abs(r.delta ?? 0) >= 0.005).length, onlyA: rows.filter((r) => r.b == null).length, onlyB: rows.filter((r) => r.a == null).length, sumA, sumB, growth: sumA ? Math.round((sumB / sumA - 1) * 1000) / 10 : null },
  };
}

/** Факт прогнозного года: заменяет ранее загруженный */
export async function saveActuals(forecastId: number, rows: { item_key: string; okpd2: string; subject: string; category: string | null; actual_price: number; contracts: number }[], author: string) {
  const db = sql();
  await db.query("DELETE FROM actuals WHERE forecast_id = $1", [forecastId]);
  for (let i = 0; i < rows.length; i += 500) {
    await db.query(
      `INSERT INTO actuals (forecast_id, item_key, okpd2, subject, category, actual_price, contracts, author)
       SELECT $1, x.item_key, x.okpd2, x.subject, x.category, x.actual_price, x.contracts, $3 FROM jsonb_to_recordset($2::jsonb)
         AS x(item_key text, okpd2 text, subject text, category text, actual_price numeric, contracts int)`,
      [forecastId, JSON.stringify(rows.slice(i, i + 500)), author]);
  }
  const f = await forecastOf(forecastId);
  await log({ forecastId, versionId: f.current_version_id, type: "actual", newValue: `позиций: ${rows.length}`, author });
  await touch(forecastId);
}

export async function factCompare(forecastId: number) {
  const f = await forecastOf(forecastId);
  const items = await getItems(f.current_version_id);
  const actuals = await sql().query("SELECT item_key, actual_price, contracts FROM actuals WHERE forecast_id = $1", [forecastId]);
  const byKey = new Map(actuals.map((a) => [a.item_key as string, a]));
  const rows = items.flatMap((i) => {
    const a = byKey.get(i.item_key);
    if (!a) return [];
    const actual = Number(a.actual_price);
    return [{ okpd2: i.okpd2, subject: i.subject, unit: i.data.unitLabel ?? i.unit, region: i.data.regionName ?? i.region, category: i.category, forecast: i.forecast_price, actual,
      errorPct: actual ? Math.round(((i.forecast_price - actual) / actual) * 1000) / 10 : null }];
  });
  const cats = new Map<string, { forecast: number; actual: number }[]>();
  for (const r of rows) cats.set(r.category ?? "Без категории", [...(cats.get(r.category ?? "Без категории") ?? []), r]);
  const m = mape(rows);
  return {
    rows: rows.sort((a, b) => Math.abs(b.errorPct ?? 0) - Math.abs(a.errorPct ?? 0)),
    matched: rows.length, forecastRows: items.length, actualRows: actuals.length,
    mape: m, accuracy: m == null ? null : Math.max(0, Math.round((100 - m) * 10) / 10),
    categories: [...cats.entries()].map(([name, xs]) => ({ name, rows: xs.length, mape: mape(xs) })).sort((a, b) => (b.mape ?? 0) - (a.mape ?? 0)).slice(0, 5),
  };
}
