import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { hasDb } from "@/lib/db";
import { findByHash } from "@/lib/forecasts/store";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  return handle(async () => (hasDb() ? findByHash(req.nextUrl.searchParams.get("hash") ?? "") : []));
}
