import { NextResponse } from "next/server";
import { hasDb } from "./db";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

export async function handle(fn: () => Promise<unknown>, write = false) {
  if (write && !hasDb()) return json({ error: "База данных не подключена (DATABASE_URL) — справочники доступны только для чтения" }, 503);
  try {
    return json(await fn());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 400);
  }
}
