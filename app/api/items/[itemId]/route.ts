import { handle } from "@/lib/api";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/** Одна строка прогноза с договорами — для страницы «Логика расчётов» */
export async function GET(_: Request, { params }: { params: { itemId: string } }) {
  return handle(async () => {
    const [r] = await sql().query(
      `SELECT i.id, i.okpd2, i.subject, i.unit, i.region, i.contracts, i.base_price, i.index_value, i.forecast_price, i.manually_edited, i.data,
              v.number AS version, f.id AS forecast_id, f.title, f.year, f.base_year
         FROM forecast_items i JOIN forecast_versions v ON v.id = i.version_id JOIN forecasts f ON f.id = v.forecast_id
        WHERE i.id = $1`, [Number(params.itemId)]);
    if (!r) throw new Error("Строка прогноза не найдена");
    return { ...r, base_price: Number(r.base_price), index_value: Number(r.index_value), forecast_price: Number(r.forecast_price) };
  });
}
