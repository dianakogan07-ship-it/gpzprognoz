"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { IconLogout } from "./Icons";

const NAV = [["/", "Прогнозы"], ["/indices", "Индексы роста"], ["/directories", "Справочники"], ["/logic", "Логика расчётов"]];

export function Header() {
  const path = usePathname();
  const router = useRouter();
  if (path === "/login") return null;
  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
  }
  return (
    <header className="border-b border-slate-200 bg-white">
      <nav className="mx-auto flex max-w-7xl flex-wrap items-center gap-1 px-4 py-3">
        <span className="mr-6 hidden font-semibold text-brand sm:inline">Прогноз цен ГПЗ</span>
        {NAV.map(([href, label]) => (
          <Link key={href} href={href}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${path === href || (href === "/" && path.startsWith("/forecasts")) ? "bg-brand-light text-brand" : "text-slate-600 hover:bg-slate-100"}`}>{label}</Link>
        ))}
        <button className="btn-sec ml-auto !px-3" onClick={logout} title="Выйти"><IconLogout /><span className="hidden sm:inline">Выйти</span></button>
      </nav>
    </header>
  );
}
