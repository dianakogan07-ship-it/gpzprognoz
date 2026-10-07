import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { createForecast, currentAuthor, listForecasts } from "@/lib/forecasts/store";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const GET = () => handle(() => listForecasts(), true);

export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = (await req.json()) as { title: string; year: number; baseYear: number };
    if (!b.title?.trim()) throw new Error("Укажите название");
    if (!(b.year > 2000) || !(b.baseYear > 2000)) throw new Error("Укажите год прогноза и базовый год");
    return createForecast({ title: b.title.trim(), year: b.year, baseYear: b.baseYear, author: currentAuthor() });
  }, true);
}
