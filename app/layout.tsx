import "./globals.css";
import type { ReactNode } from "react";
import { Header } from "@/components/Header";
import { UpdateWatcher } from "@/components/UpdateWatcher";

export const metadata = { title: "Ориентир", description: "Обезличенный справочник прогнозных цен по предметам закупки" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Header />
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <UpdateWatcher />
      </body>
    </html>
  );
}
