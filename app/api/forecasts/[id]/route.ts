import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { changeYears, currentAuthor, deleteForecast, getForecast, updateCard } from "@/lib/forecasts/store";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const GET = (req: NextRequest, { params }: { params: { id: string } }) =>
  handle(() => getForecast(Number(params.id), Number(req.nextUrl.searchParams.get("v")) || undefined), true);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  return handle(async () => {
    const b = (await req.json()) as { title?: string; color?: string | null; year?: number; baseYear?: number };
    await updateCard(Number(params.id), b, currentAuthor());
    const v = b.year && b.baseYear ? await changeYears(Number(params.id), b.year, b.baseYear, currentAuthor()) : null;
    return { ok: true, newVersion: v };
  }, true);
}

export const DELETE = (_: NextRequest, { params }: { params: { id: string } }) =>
  handle(async () => { await deleteForecast(Number(params.id)); return { ok: true }; }, true);
