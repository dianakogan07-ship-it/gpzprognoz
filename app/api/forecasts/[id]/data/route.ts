import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { currentAuthor, newDataVersion } from "@/lib/forecasts/store";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/** Начало загрузки новых файлов ГПЗ и отчётности: создаёт пустую новую версию */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return handle(async () => {
    const { year, baseYear } = (await req.json()) as { year: number; baseYear: number };
    return newDataVersion(Number(params.id), year, baseYear, currentAuthor());
  }, true);
}
