import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { tenderReserve } from "@/lib/forecasts/accuracy";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const GET = (req: NextRequest) => handle(() => tenderReserve(Number(req.nextUrl.searchParams.get("upTo")) || new Date().getFullYear()), true);
