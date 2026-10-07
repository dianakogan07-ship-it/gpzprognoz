import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { approveIndices } from "@/lib/mer/commit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const { ids } = (await req.json()) as { ids: number[] };
    if (!Array.isArray(ids)) throw new Error("Ожидается { ids: [...] }");
    return approveIndices(ids.map(Number).filter(Number.isFinite));
  }, true);
}
