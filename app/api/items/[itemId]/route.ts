import { handle } from "@/lib/api";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/** Одна строка прогноза с договорами и её история по версиям — для карточки позиции и «Логики расчётов» */
export async function GET(_: Request, { params }: { params: { itemId: string } }) {
  return handle(async () => {
    const db = sql();
    const [r] = await db.query(
      `SELECT i.id, i.item_key, i.okpd2, i.subject, i.unit, i.region, i.contracts, i.base_price, i.index_value, i.forecast_price, i.manually_edited, i.data,
              v.number AS version, f.id AS forecast_id, f.title, f.year, f.base_year
         FROM forecast_items i JOIN forecast_versions v ON v.id = i.version_id JOIN forecasts f ON f.id = v.forecast_id
        WHERE i.id = $1`, [Number(params.itemId)]);
    if (!r) throw new Error("Строка прогноза не найдена");
    // Та же позиция во всех версиях прогноза и правки по ней
    const versions = await db.query(
      `SELECT v.number, v.created_at, v.comment, i.id, i.contracts, i.base_price, i.forecast_price, i.manually_edited,
              (i.data->>'rawMedian')::numeric AS raw_median, i.data->>'indexKey' AS index_key, i.data->>'indexLevel' AS index_level
         FROM forecast_items i JOIN forecast_versions v ON v.id = i.version_id
        WHERE v.forecast_id = $1 AND i.item_key = $2 ORDER BY v.number DESC`, [r.forecast_id, r.item_key]);
    const edits = await db.query(
      `SELECT l.created_at, v.number AS version, l.event_type, l.field, l.old_value, l.new_value, l.reason, l.author
         FROM change_log l JOIN forecast_items i ON i.id = l.item_id LEFT JOIN forecast_versions v ON v.id = l.version_id
        WHERE l.forecast_id = $1 AND i.item_key = $2 ORDER BY l.created_at DESC`, [r.forecast_id, r.item_key]);
    return {
      ...r, base_price: Number(r.base_price), index_value: Number(r.index_value), forecast_price: Number(r.forecast_price),
      history: versions.map((x) => ({ ...x, base_price: Number(x.base_price), forecast_price: Number(x.forecast_price), raw_median: x.raw_median == null ? null : Number(x.raw_median) })),
      edits,
    };
  });
}
