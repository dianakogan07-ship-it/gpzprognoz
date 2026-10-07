export const AUTH_COOKIE = "gpz_session";

/** Токен сессии: SHA-256 от логина и пароля из переменных окружения (меняется при смене пароля) */
export async function sessionToken(): Promise<string | null> {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !pass) return null;
  const data = new TextEncoder().encode(`gpz:${user}:${pass}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
