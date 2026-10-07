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
  let n = 0;
  for (const id of ids) {
    const [row] = await db.query("SELECT id, pending_of FROM price_indices WHERE id = $1", [id]);
    if (!row) continue;
    if (row.pending_of) {
      await db.query("UPDATE price_indices SET superseded_at = now() WHERE id = $1", [row.pending_of]);
      await db.query("UPDATE price_indices SET pending_of = NULL, approved = TRUE WHERE id = $1", [id]);
    } else {
      await db.query("UPDATE price_indices SET approved = TRUE WHERE id = $1", [id]);
    }
    n++;
  }
  return { approved: n };
}
