import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { currentAuthor, recalc } from "@/lib/forecasts/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const POST = (_: NextRequest, { params }: { params: { id: string } }) => handle(() => recalc(Number(params.id), currentAuthor()), true);
