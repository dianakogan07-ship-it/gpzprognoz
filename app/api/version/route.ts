import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Номер текущей сборки сайта */
export const GET = () => NextResponse.json({ build: process.env.NEXT_PUBLIC_BUILD_ID ?? "" }, { headers: { "Cache-Control": "no-store" } });
