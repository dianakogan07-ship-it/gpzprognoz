import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { commitMer } from "@/lib/mer/commit";
import type { MerDoc, MerIncoming } from "@/lib/mer/plan";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  return handle(async () => {
    const { doc, rows } = (await req.json()) as { doc: MerDoc; rows: MerIncoming[] };
    if (!doc?.title?.trim()) throw new Error("Укажите название документа");
    const KINDS = ["forecast", "cpi", "wage", "fx", "forecast_cons", "cpi_cons", "wage_cons", "fx_cons"];
    const bad = rows.find((r) => !KINDS.includes(r.kind) || !(r.value > 0) || !r.year || (/^(forecast|fx)/.test(r.kind) && !r.key));
    if (bad) throw new Error(`Строка не заполнена: ${bad.raw_line}`);
    return commitMer({ title: doc.title.trim(), date: doc.date?.trim() || null }, rows);
  }, true);
}
