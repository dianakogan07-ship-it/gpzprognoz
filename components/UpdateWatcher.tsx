"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const CHECK_EVERY = 60_000;
const COUNTDOWN = 5;

/**
 * Следит за обновлением сайта: если на сервере новая сборка, показывает окно
 * и через несколько секунд выходит из сервиса на страницу входа.
 */
export function UpdateWatcher() {
  const path = usePathname();
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (path === "/login") return;
    const mine = process.env.NEXT_PUBLIC_BUILD_ID;
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState === "hidden") return;
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const { build } = await r.json();
        if (build && mine && build !== mine) { stopped = true; setLeft(COUNTDOWN); }
      } catch { /* нет связи — проверим позже */ }
    };
    const t = setInterval(check, CHECK_EVERY);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { stopped = true; clearInterval(t); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [path]);

  useEffect(() => {
    if (left == null) return;
    if (left <= 0) {
      fetch("/api/logout", { method: "POST" }).finally(() => window.location.replace("/login"));
      return;
    }
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  if (left == null) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4" role="alertdialog" aria-modal="true" aria-labelledby="upd-title">
      <div className="w-full max-w-md rounded-xl bg-white px-8 py-8 text-center shadow-xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-light text-brand">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 0 0-15.5-6.2L3 8M3 3v5h5M3 12a9 9 0 0 0 15.5 6.2L21 16M21 21v-5h-5" />
          </svg>
        </div>
        <h2 id="upd-title" className="mt-5 text-lg font-semibold text-slate-900">На сайт были внесены изменения</h2>
        <p className="mt-2 text-sm text-slate-600">
          Через <b className="text-slate-900">{Math.max(left, 0)}</b> сек. вы будете перенаправлены на страницу входа. Войдите снова, чтобы продолжить работу в обновлённой версии.
        </p>
      </div>
    </div>
  );
}
