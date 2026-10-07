import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { currentAuthor, editItem, type EditField } from "@/lib/forecasts/store";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  return handle(async () => {
    const b = (await req.json()) as { field: EditField; value: number | boolean; reason: string };
    return editItem(Number(params.id), Number(params.itemId), b.field, b.value, b.reason, currentAuthor());
  }, true);
}
