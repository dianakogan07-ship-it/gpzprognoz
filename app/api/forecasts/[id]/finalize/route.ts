import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import type { ExcludedRow } from "@/lib/forecast";
import { currentAuthor, finalizeUpload } from "@/lib/forecasts/store";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return handle(async () => {
    const b = (await req.json()) as { versionId: number; gpzRows: number; excluded: number; excludedRows?: ExcludedRow[] };
    return finalizeUpload(Number(params.id), b.versionId, { gpzRows: b.gpzRows, excluded: b.excluded, excludedRows: b.excludedRows, author: currentAuthor() });
  }, true);
}
