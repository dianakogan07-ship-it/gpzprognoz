"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { IconLogout } from "./Icons";

const NAV = [["/", "Прогноз цен"], ["/indices", "Индексы роста"], ["/directories", "Справочники"]];

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
      <nav className="mx-auto flex max-w-7xl items-center gap-1 px-4 py-3">
        <span className="mr-6 font-semibold text-brand">Прогноз цен ГПЗ</span>
        {NAV.map(([href, label]) => (
          <Link key={href} href={href}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${path === href ? "bg-brand-light text-brand" : "text-slate-600 hover:bg-slate-100"}`}>{label}</Link>
        ))}
        <button className="btn-sec ml-auto" onClick={logout}><IconLogout />Выйти</button>
      </nav>
    </header>
  );
}
