import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { currentAuthor, factCompare, saveActuals } from "@/lib/forecasts/store";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export const GET = (_: NextRequest, { params }: { params: { id: string } }) => handle(() => factCompare(Number(params.id)), true);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return handle(async () => {
    const { rows } = (await req.json()) as { rows: Parameters<typeof saveActuals>[1] };
    await saveActuals(Number(params.id), rows, currentAuthor());
    return factCompare(Number(params.id));
  }, true);
}
