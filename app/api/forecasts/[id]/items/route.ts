import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { appendItems, getItems } from "@/lib/forecasts/store";
import type { ForecastRow } from "@/lib/forecast";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export const GET = (req: NextRequest) => handle(() => getItems(Number(req.nextUrl.searchParams.get("version"))), true);

/** Догрузка строк нового прогноза частями */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return handle(async () => {
    const { versionId, rows } = (await req.json()) as { versionId: number; rows: ForecastRow[] };
    await appendItems(Number(params.id), versionId, rows);
    return { ok: true };
  }, true);
}
