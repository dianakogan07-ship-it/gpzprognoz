import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, sessionToken } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const token = await sessionToken();
  if (!token) return NextResponse.next(); // логин и пароль не заданы — вход не требуется
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();
  if (req.cookies.get(AUTH_COOKIE)?.value === token) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
