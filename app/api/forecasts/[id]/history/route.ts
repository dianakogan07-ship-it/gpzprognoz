import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { history } from "@/lib/forecasts/store";

export const dynamic = "force-dynamic";
export const GET = (_: NextRequest, { params }: { params: { id: string } }) => handle(() => history(Number(params.id)), true);
