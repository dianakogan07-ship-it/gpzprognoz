import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { compareVersions } from "@/lib/forecasts/store";

export const dynamic = "force-dynamic";

/** ?a=версия&b=версия[&changed=1][&byOkpd=1 — для сравнения прогнозов разных лет] */
export function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  return handle(() => compareVersions(Number(p.get("a")), Number(p.get("b")), p.get("changed") === "1", p.get("byOkpd") === "1"), true);
}
