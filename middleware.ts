import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !pass) return NextResponse.next();
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    const [u, ...p] = atob(auth.slice(6)).split(":");
    if (u === user && p.join(":") === pass) return NextResponse.next();
  }
  return new NextResponse("Требуется авторизация", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="gpz", charset="UTF-8"' } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
