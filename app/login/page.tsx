"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { IconLock } from "@/components/Icons";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/";
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login, password }) });
    if (r.ok) { router.replace(next.startsWith("/") ? next : "/"); router.refresh(); }
    else { setError((await r.json()).error ?? "Ошибка входа"); setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="card w-full max-w-md space-y-5">
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Ориентир — прогноз цен закупок" width={1000} height={161} className="mx-auto h-auto w-full max-w-xs" />
        <h1 className="sr-only">Ориентир</h1>
        <p className="hint mt-4 text-center">Войдите, чтобы продолжить</p>
      </div>
      <div>
        <label className="field-label" htmlFor="login">Логин</label>
        <input id="login" className="inp py-2.5 text-base" placeholder="Введите логин" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} autoFocus />
      </div>
      <div>
        <label className="field-label" htmlFor="password">Пароль</label>
        <input id="password" type="password" className="inp py-2.5 text-base" placeholder="Введите пароль" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="btn w-full py-3 text-base" disabled={busy || !login || !password}><IconLock />Войти</button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Suspense><LoginForm /></Suspense>
    </div>
  );
}
