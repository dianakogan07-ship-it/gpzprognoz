import { NextRequest } from "next/server";
import { deleteRow, insertRow, isTable, listTable, updateRow } from "@/lib/db";
import { handle, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
type Ctx = { params: { table: string } };
const bad = () => json({ error: "Неизвестный справочник" }, 404);

export async function GET(_: NextRequest, { params }: Ctx) {
  if (!isTable(params.table)) return bad();
  const t = params.table;
  return handle(() => listTable(t));
}
export async function POST(req: NextRequest, { params }: Ctx) {
  if (!isTable(params.table)) return bad();
  const t = params.table;
  return handle(async () => insertRow(t, await req.json()), true);
}
export async function PUT(req: NextRequest, { params }: Ctx) {
  if (!isTable(params.table)) return bad();
  const t = params.table;
  const pk = req.nextUrl.searchParams.get("pk");
  return handle(async () => updateRow(t, pk, await req.json()), true);
}
export async function DELETE(req: NextRequest, { params }: Ctx) {
  if (!isTable(params.table)) return bad();
  const t = params.table;
  const pk = req.nextUrl.searchParams.get("pk");
  return handle(async () => { await deleteRow(t, pk); return { ok: true }; }, true);
}
