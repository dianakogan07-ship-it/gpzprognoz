import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { commitToDecember } from "@/lib/mer/commit";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

/** Сохранение индексов пересчёта до декабря, рассчитанных из файла Росстата в браузере */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const { rows } = (await req.json()) as { rows: { key: string; year: number; month: number; value: number; note: string }[] };
    if (!Array.isArray(rows) || !rows.length) throw new Error("Нет значений для сохранения");
    const bad = rows.find((r) => !r.key || !(r.month >= 1 && r.month <= 12) || !(r.value > 0) || !r.year);
    if (bad) throw new Error(`Неверная строка: ${JSON.stringify(bad)}`);
    return commitToDecember(rows);
  }, true);
}
