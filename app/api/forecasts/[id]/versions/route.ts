import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { currentAuthor, newVersion } from "@/lib/forecasts/store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return handle(async () => {
    const { comment } = (await req.json()) as { comment: string };
    if (!comment?.trim()) throw new Error("Опишите, что меняется в новой версии");
    return newVersion(Number(params.id), comment.trim(), currentAuthor());
  }, true);
}
