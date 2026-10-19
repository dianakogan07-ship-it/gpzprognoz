import { neon } from "@neondatabase/serverless";
import { SEED } from "./seed";
import type { Reference } from "./types";
import { MIGRATIONS_SQL, SCHEMA_SQL } from "./schema";
import { formatGrowth } from "./indexFormat";

export const hasDb = () => Boolean(process.env.DATABASE_URL);

type Row = Record<string, any>;
type Db = { query: (text: string, params?: unknown[]) => Promise<Row[]> };
let local: Db | null = null;

export function sql(): Db {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL не задан");
  // Для локальной проверки: обычный PostgreSQL вместо Neon (DATABASE_URL=local, PG_LOCAL_HOST=/путь/к/сокету)
  if (process.env.DATABASE_URL === "local") return (local ??= localPg());
  // Запросы к Neon идут через fetch: без no-store Next.js/Vercel кэширует их ответы, и страницы видят старые данные
  return neon(process.env.DATABASE_URL, { fetchOptions: { cache: "no-store" } }) as unknown as Db;
}

function localPg(): Db {
  let pool: Promise<{ query: (t: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }> | null = null;
  return {
    async query(text, params) {
      pool ??= import(/* webpackIgnore: true */ "pg" as string).then((m) => new (m.default ?? m).Pool({ host: process.env.PG_LOCAL_HOST, port: Number(process.env.PG_LOCAL_PORT ?? 5432), user: process.env.PG_LOCAL_USER ?? "postgres", database: process.env.PG_LOCAL_DB ?? "postgres" }));
      return (await (await pool).query(text, params)).rows;
    },
  };
}

/** Описание редактируемых справочников: таблица, ключ, колонки */
export const TABLES = {
  sources: { pk: "id", cols: ["code", "name", "url", "kind", "verified", "note"], order: "id" },
  categories: { pk: "id", cols: ["name", "short_name"], order: "name" },
  purchase_types: { pk: "id", cols: ["name"], order: "id" },
  purchase_forms: { pk: "id", cols: ["name"], order: "id" },
  purchase_methods: { pk: "id", cols: ["name"], order: "id" },
  regions: { pk: "code", cols: ["code", "name"], order: "code" },
  okei: { pk: "code", cols: ["code", "name", "short"], order: "code" },
  okved2: { pk: "letter", cols: ["letter", "name", "div_from", "div_to"], order: "letter" },
  okpd2: { pk: "code", cols: ["code", "name"], order: "code" },
  ws_codes: { pk: "code", cols: ["code", "name", "category", "auto_added"], order: "code" },
  repeat_rules: { pk: "id", cols: ["kind", "prefix", "repeatable", "note"], order: "kind, prefix" },
  price_indices: {
    pk: "id",
    cols: ["kind", "key", "year", "month", "value", "source_code", "approved", "note", "raw_line", "doc_title", "doc_date", "doc_page", "indicator", "ref_deflator", "change_note"],
    order: "kind, year, key, month, id",
  },
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
/** Раздел прогнозов создан впервые — нужно добавить примеры */
let needDemo = false;
let demo: Promise<void> | null = null;

/** Примеры прогнозов в новой базе (вызывается из списка прогнозов, после ensureSchema) */
export async function ensureDemo() {
  await ensureSchema();
  if (!needDemo || process.env.SEED_DEMO === "0") return;
  demo ??= import("./forecasts/demo").then((m) => m.seedDemo()).then(() => { needDemo = false; });
  return demo;
}

/** Создаёт таблицы и стартовые справочники, если база пустая */
export function ensureSchema(): Promise<void> {
  ready ??= (async () => {
    const db = sql();
    const [{ t, f }] = await db.query("SELECT to_regclass('public.price_indices') AS t, to_regclass('public.forecasts') AS f");
    const stmts = (s: string) => s.split(";").map((x) => x.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
    if (!t) for (const stmt of stmts(SCHEMA_SQL)) await db.query(stmt);
    for (const stmt of stmts(MIGRATIONS_SQL)) await db.query(stmt);
    if (t) {
      // Примеры прогнозов — только когда раздел прогнозов появился впервые
      if (!f) needDemo = true;
      return;
    }
    for (const name of Object.keys(TABLES) as TableName[]) {
      await upsertRows(name, (SEED_BY_TABLE[name] as Record<string, unknown>[]).map(({ id: _id, ...r }) => r));
    }
    needDemo = true;
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

export async function listTable(t: TableName): Promise<Record<string, unknown>[]> {
  if (!hasDb()) return SEED_BY_TABLE[t] as Record<string, unknown>[];
  await ensureSchema();
  const def = TABLES[t];
  const rows = await sql().query(`SELECT * FROM ${t} ORDER BY ${def.order}`);
  return t === "price_indices"
    ? rows.map((r) => ({ ...r, value: Number(r.value), ref_deflator: r.ref_deflator == null ? null : Number(r.ref_deflator) }))
    : rows;
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
    if (t === "price_indices") {
      // Утверждённый индекс с другим значением не перезаписываем: новое значение — версией на проверку, прежнее остаётся в истории
      const r = row as { kind: string; key?: string | null; year: number; month?: number | null; value: number };
      const [cur] = await db.query(
        `SELECT id, value, approved FROM price_indices WHERE kind = $1 AND COALESCE(key, '') = $2 AND year = $3 AND COALESCE(month, 0) = $4 AND pending_of IS NULL AND superseded_at IS NULL`,
        [r.kind, r.key ?? "", r.year, r.month ?? 0]);
      if (cur?.approved && Math.abs(Number(cur.value) - Number(r.value)) > 0.000005) {
        const vcols = cols.filter((c) => c !== "approved");
        const vvals = vcols.map((c) => vals[cols.indexOf(c)]);
        const [pend] = await db.query("SELECT id FROM price_indices WHERE pending_of = $1", [cur.id]);
        const note = `Утверждено ${formatGrowth(Number(cur.value))}, новое значение ${formatGrowth(Number(r.value))}`;
        if (pend) await db.query(`UPDATE price_indices SET ${vcols.map((c, i) => `${c} = $${i + 1}`).join(", ")}, approved = FALSE, change_note = $${vcols.length + 1}, loaded_at = now() WHERE id = $${vcols.length + 2}`, [...vvals, note, pend.id]);
        else await db.query(`INSERT INTO price_indices (${vcols.join(", ")}, approved, pending_of, change_note, loaded_at) VALUES (${vcols.map((_, i) => `$${i + 1}`).join(", ")}, FALSE, $${vcols.length + 1}, $${vcols.length + 2}, now())`, [...vvals, cur.id, note]);
        updated++;
        continue;
      }
    }
    const natural = def.pk !== "id" && cols.includes(def.pk);
    const conflict = t === "price_indices"
      ? ` ON CONFLICT (kind, COALESCE(key, ''), year, COALESCE(month, 0)) WHERE pending_of IS NULL AND superseded_at IS NULL DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}, loaded_at = now()`
      : natural ? ` ON CONFLICT (${def.pk}) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}`
      : t === "repeat_rules" ? ` ON CONFLICT (kind, prefix) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}`
      : " ON CONFLICT DO NOTHING";
    const res = await db.query(`INSERT INTO ${t} (${cols.join(", ")}) VALUES (${ph})${conflict} RETURNING (xmax = 0) AS inserted`, vals);
    if (res[0]?.inserted) inserted++; else if (res.length) updated++;
  }
  return { saved: inserted + updated, inserted, updated };
}

export { SEED_BY_TABLE };
