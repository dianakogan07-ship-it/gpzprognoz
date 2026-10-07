import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Пополнение справочника кодов WS новыми кодами из загруженной отчётности */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const { codes } = (await req.json()) as { codes: string[] };
    const valid = (codes ?? []).filter((c) => /^WS\d+$/.test(c));
    const db = sql();
    for (const c of valid) await db.query("INSERT INTO ws_codes (code, auto_added) VALUES ($1, TRUE) ON CONFLICT DO NOTHING", [c]);
    return { added: valid.length };
  }, true);
}
