// Создаёт таблицы и заполняет стартовые справочники: DATABASE_URL=... npm run db:setup
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql, upsertRows, SEED_BY_TABLE, TABLES, type TableName } from "../lib/db";

async function main() {
  const db = sql();
  const ddl = readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
  for (const stmt of ddl.split(";").map((s) => s.trim()).filter(Boolean)) await db.query(stmt);
  for (const t of Object.keys(TABLES) as TableName[]) {
    const rows = (SEED_BY_TABLE[t] as Record<string, unknown>[]).map(({ id: _id, ...r }) => r);
    const n = await upsertRows(t, rows);
    console.log(`${t}: ${n}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
