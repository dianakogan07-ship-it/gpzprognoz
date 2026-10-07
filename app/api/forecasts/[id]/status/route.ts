import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { currentAuthor, setStatus } from "@/lib/forecasts/store";
import type { ForecastStatus } from "@/lib/forecasts/model";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return handle(async () => {
    const { to, reason } = (await req.json()) as { to: ForecastStatus; reason?: string };
    await setStatus(Number(params.id), to, currentAuthor(), reason);
    return { ok: true };
  }, true);
}
