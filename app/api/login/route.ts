import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, sessionToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { login, password } = (await req.json()) as { login?: string; password?: string };
  const token = await sessionToken();
  if (!token) return NextResponse.json({ ok: true });
  if (login !== process.env.BASIC_AUTH_USER || password !== process.env.BASIC_AUTH_PASSWORD) {
    return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
