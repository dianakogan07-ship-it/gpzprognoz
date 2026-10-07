import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { currentAuthor, finalizeUpload } from "@/lib/forecasts/store";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return handle(async () => {
    const b = (await req.json()) as { versionId: number; gpzRows: number; excluded: number };
    return finalizeUpload(Number(params.id), b.versionId, { gpzRows: b.gpzRows, excluded: b.excluded, author: currentAuthor() });
  }, true);
}
