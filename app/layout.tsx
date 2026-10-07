import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = { title: "Прогноз цен ГПЗ", description: "Обезличенный справочник прогнозных цен по предметам закупки" };

const NAV = [["/", "Прогноз цен"], ["/indices", "Индексы роста"], ["/directories", "Справочники"]];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <header className="border-b bg-white">
          <nav className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
            <span className="font-semibold">Прогноз цен ГПЗ</span>
            {NAV.map(([href, label]) => <Link key={href} href={href} className="text-sm text-blue-700 hover:underline">{label}</Link>)}
          </nav>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
