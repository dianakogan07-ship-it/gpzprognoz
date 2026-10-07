import { NextRequest } from "next/server";
import { isTable, upsertRows } from "@/lib/db";
import { handle, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { table: string } }) {
  if (!isTable(params.table)) return json({ error: "Неизвестный справочник" }, 404);
  const t = params.table;
  return handle(async () => {
    const { rows } = (await req.json()) as { rows: Record<string, unknown>[] };
    if (!Array.isArray(rows)) throw new Error("Ожидается { rows: [...] }");
    return upsertRows(t, rows);
  }, true);
}
