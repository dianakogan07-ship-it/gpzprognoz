import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { getForecast } from "@/lib/forecasts/store";

export const dynamic = "force-dynamic";
export const GET = (req: NextRequest, { params }: { params: { id: string } }) =>
  handle(() => getForecast(Number(params.id), Number(req.nextUrl.searchParams.get("v")) || undefined), true);
