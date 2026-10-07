import { listTable, sql } from "../db";
import type { PriceIndex } from "../types";
import { planMerCommit, summarize, type MerDoc, type MerIncoming } from "./plan";

const SOURCE = "MER_FORECAST";

/** Сохранение значений прогноза МЭР: всё со статусом «Нужна проверка», утверждённые не затираются */
export async function commitMer(doc: MerDoc, incoming: MerIncoming[]) {
  const existing = (await listTable("price_indices")) as unknown as PriceIndex[];
  const actions = planMerCommit(existing, incoming);
  const db = sql();
  const fields = (r: MerIncoming) => [r.value, r.indicator, r.ref_deflator, r.raw_line, r.doc_page, doc.title, doc.date, SOURCE];
  for (const a of actions) {
    const r = a.row;
    if (a.type === "insert") {
      await db.query(
        `INSERT INTO price_indices (kind, key, year, month, value, indicator, ref_deflator, raw_line, doc_page, doc_title, doc_date, source_code, approved, loaded_at)
         VALUES ($9, $10, $11, NULL, $1, $2, $3, $4, $5, $6, $7, $8, FALSE, now())`,
        [...fields(r), r.kind, r.key, r.year],
      );
    } else if (a.type === "update") {
      await db.query(
        `UPDATE price_indices SET value = $1, indicator = $2, ref_deflator = $3, raw_line = $4, doc_page = $5, doc_title = $6, doc_date = $7,
           source_code = $8, change_note = COALESCE($9, change_note), loaded_at = now() WHERE id = $10`,
        [...fields(r), a.change, a.id],
      );
    } else if (a.type === "version") {
      if (a.pendingId) {
        await db.query(
          `UPDATE price_indices SET value = $1, indicator = $2, ref_deflator = $3, raw_line = $4, doc_page = $5, doc_title = $6, doc_date = $7,
             source_code = $8, change_note = $9, approved = FALSE, loaded_at = now() WHERE id = $10`,
          [...fields(r), a.change, a.pendingId],
        );
      } else {
        await db.query(
          `INSERT INTO price_indices (kind, key, year, month, value, indicator, ref_deflator, raw_line, doc_page, doc_title, doc_date, source_code, approved, pending_of, change_note, loaded_at)
           VALUES ($9, $10, $11, NULL, $1, $2, $3, $4, $5, $6, $7, $8, FALSE, $12, $13, now())`,
          [...fields(r), r.kind, r.key, r.year, a.of, a.change],
        );
      }
    } else {
      // Значение не изменилось — отмечаем дату загрузки из источника
      await db.query("UPDATE price_indices SET loaded_at = now() WHERE id = $1", [a.id]);
    }
  }
  return summarize(actions);
}

/** Утверждение индексов. Новая версия заменяет прежний утверждённый индекс */
export async function approveIndices(ids: number[]) {
  const db = sql();
  // Обычные индексы — одним запросом, их может быть тысячи (пересчёт по месяцам)
  const plain = await db.query("UPDATE price_indices SET approved = TRUE WHERE id = ANY($1::int[]) AND pending_of IS NULL RETURNING id", [ids]);
  let n = plain.length;
  // Новые версии заменяют прежний утверждённый индекс
  const pending = await db.query("SELECT id, pending_of FROM price_indices WHERE id = ANY($1::int[]) AND pending_of IS NOT NULL", [ids]);
  for (const row of pending) {
    await db.query("UPDATE price_indices SET superseded_at = now() WHERE id = $1", [row.pending_of]);
    await db.query("UPDATE price_indices SET pending_of = NULL, approved = TRUE WHERE id = $1", [row.id]);
    n++;
  }
  return { approved: n };
}

/** Индексы пересчёта до декабря (Росстат): пачками, одним запросом на 500 строк. Изменившееся значение снимает утверждение */
export async function commitToDecember(rows: { key: string; year: number; month: number; value: number; note: string }[]) {
  const db = sql();
  let inserted = 0, updated = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const res = await db.query(
      `INSERT INTO price_indices (kind, key, year, month, value, source_code, approved, note, loaded_at)
       SELECT 'to_december', x.key, x.year, x.month, x.value, 'ROSSTAT_ICP', FALSE, x.note, now()
         FROM jsonb_to_recordset($1::jsonb) AS x(key text, year int, month int, value numeric, note text)
       ON CONFLICT (kind, COALESCE(key, ''), year, COALESCE(month, 0)) WHERE pending_of IS NULL AND superseded_at IS NULL
       DO UPDATE SET value = EXCLUDED.value, note = EXCLUDED.note, source_code = EXCLUDED.source_code, loaded_at = now(),
         approved = price_indices.approved AND price_indices.value = EXCLUDED.value
       RETURNING (xmax = 0) AS inserted`,
      [JSON.stringify(rows.slice(i, i + 500))],
    );
    for (const r of res) if (r.inserted) inserted++; else updated++;
  }
  return { inserted, updated };
}
