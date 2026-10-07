import { neon } from "@neondatabase/serverless";
import { SEED } from "./seed";
import type { Reference } from "./types";
import { SCHEMA_SQL } from "./schema";

export const hasDb = () => Boolean(process.env.DATABASE_URL);

export function sql() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL не задан");
  return neon(process.env.DATABASE_URL);
}

/** Описание редактируемых справочников: таблица, ключ, колонки */
export const TABLES = {
  sources: { pk: "id", cols: ["code", "name", "url", "kind", "verified", "note"], order: "id" },
  categories: { pk: "id", cols: ["name"], order: "name" },
  purchase_types: { pk: "id", cols: ["name"], order: "id" },
  purchase_forms: { pk: "id", cols: ["name"], order: "id" },
  purchase_methods: { pk: "id", cols: ["name"], order: "id" },
  regions: { pk: "code", cols: ["code", "name"], order: "code" },
  okei: { pk: "code", cols: ["code", "name", "short"], order: "code" },
  okved2: { pk: "letter", cols: ["letter", "name", "div_from", "div_to"], order: "letter" },
  okpd2: { pk: "code", cols: ["code", "name"], order: "code" },
  ws_codes: { pk: "code", cols: ["code", "name", "category", "auto_added"], order: "code" },
  repeat_rules: { pk: "id", cols: ["kind", "prefix", "repeatable", "note"], order: "kind, prefix" },
  price_indices: { pk: "id", cols: ["kind", "key", "year", "month", "value", "source_code", "approved", "note"], order: "kind, year, key, month" },
} as const;
export type TableName = keyof typeof TABLES;
export const isTable = (t: string): t is TableName => t in TABLES;

const SEED_BY_TABLE: Record<TableName, unknown[]> = {
  sources: SEED.sources, categories: SEED.categories, purchase_types: SEED.purchaseTypes,
  purchase_forms: SEED.purchaseForms, purchase_methods: SEED.purchaseMethods, regions: SEED.regions,
  okei: SEED.okei, okved2: SEED.okved2, okpd2: SEED.okpd2, ws_codes: SEED.ws,
  repeat_rules: SEED.repeatRules, price_indices: SEED.indices,
};

let ready: Promise<void> | null = null;

/** Создаёт таблицы и стартовые справочники, если база пустая */
export function ensureSchema(): Promise<void> {
  ready ??= (async () => {
    const db = sql();
    const [{ t }] = await db.query("SELECT to_regclass('public.price_indices') AS t");
    if (t) return;
    for (const stmt of SCHEMA_SQL.split(";").map((s) => s.trim()).filter(Boolean)) await db.query(stmt);
    for (const name of Object.keys(TABLES) as TableName[]) {
      await upsertRows(name, (SEED_BY_TABLE[name] as Record<string, unknown>[]).map(({ id: _id, ...r }) => r));
    }
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

export async function listTable(t: TableName): Promise<Record<string, unknown>[]> {
  if (!hasDb()) return SEED_BY_TABLE[t] as Record<string, unknown>[];
  await ensureSchema();
  const def = TABLES[t];
  const rows = await sql().query(`SELECT * FROM ${t} ORDER BY ${def.order}`);
  return t === "price_indices" ? rows.map((r) => ({ ...r, value: Number(r.value) })) : rows;
}

export async function loadReference(): Promise<Reference> {
  const [sources, categories, purchaseTypes, purchaseForms, purchaseMethods, regions, okei, okved2, okpd2, ws, repeatRules, indices] =
    await Promise.all(([
      "sources", "categories", "purchase_types", "purchase_forms", "purchase_methods", "regions",
      "okei", "okved2", "okpd2", "ws_codes", "repeat_rules", "price_indices",
    ] as TableName[]).map(listTable));
  return { sources, categories, purchaseTypes, purchaseForms, purchaseMethods, regions, okei, okved2, okpd2, ws, repeatRules, indices } as unknown as Reference;
}

function pick(t: TableName, row: Record<string, unknown>) {
  const cols = (TABLES[t].cols as readonly string[]).filter((c) => c in row);
  return { cols, vals: cols.map((c) => (row[c] === "" ? null : row[c])) };
}

export async function insertRow(t: TableName, row: Record<string, unknown>) {
  const { cols, vals } = pick(t, row);
  const ph = cols.map((_, i) => `$${i + 1}`).join(", ");
  const [r] = await sql().query(`INSERT INTO ${t} (${cols.join(", ")}) VALUES (${ph}) RETURNING *`, vals);
  return r;
}

export async function updateRow(t: TableName, pk: unknown, row: Record<string, unknown>) {
  const { cols, vals } = pick(t, row);
  if (!cols.length) throw new Error("Нет полей для обновления");
  const set = cols.map((c, i) => `${c} = $${i + 1}`).join(", ");
  const [r] = await sql().query(`UPDATE ${t} SET ${set} WHERE ${TABLES[t].pk} = $${cols.length + 1} RETURNING *`, [...vals, pk]);
  return r;
}

export async function deleteRow(t: TableName, pk: unknown) {
  await sql().query(`DELETE FROM ${t} WHERE ${TABLES[t].pk} = $1`, [pk]);
}

/** Массовая загрузка: вставка или обновление по ключу (для таблиц с естественным ключом) */
export async function upsertRows(t: TableName, rows: Record<string, unknown>[]) {
  const def = TABLES[t];
  const db = sql();
  let inserted = 0, updated = 0;
  for (const row of rows) {
    const { cols, vals } = pick(t, row);
    if (!cols.length) continue;
    const ph = cols.map((_, i) => `$${i + 1}`).join(", ");
    const natural = def.pk !== "id" && cols.includes(def.pk);
    const conflict = t === "price_indices"
      ? ` ON CONFLICT (kind, COALESCE(key, ''), year, COALESCE(month, 0)) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}`
      : natural ? ` ON CONFLICT (${def.pk}) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}`
      : t === "repeat_rules" ? ` ON CONFLICT (kind, prefix) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}`
      : " ON CONFLICT DO NOTHING";
    const res = await db.query(`INSERT INTO ${t} (${cols.join(", ")}) VALUES (${ph})${conflict} RETURNING (xmax = 0) AS inserted`, vals);
    if (res[0]?.inserted) inserted++; else if (res.length) updated++;
  }
  return { saved: inserted + updated, inserted, updated };
}

export { SEED_BY_TABLE };
