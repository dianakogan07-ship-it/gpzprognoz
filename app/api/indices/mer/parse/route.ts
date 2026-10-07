import { NextRequest } from "next/server";
import { json } from "@/lib/api";
import { parseMer } from "@/lib/mer/parse";
import { xlsxToPages } from "@/lib/mer/xlsx";
import { pdfToPages } from "@/lib/mer/pdf";
import type { Page } from "@/lib/mer/grid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Разбор прогноза МЭР на сервере. Принимает файл (PDF или XLSX) или уже извлечённые
 * в браузере страницы — для PDF больше лимита размера запроса.
 */
export async function POST(req: NextRequest) {
  try {
    const year = Number(req.nextUrl.searchParams.get("year"));
    if (!year) return json({ error: "Не указан год прогноза" }, 400);
    let pages: Page[];
    if (req.headers.get("content-type")?.includes("application/json")) {
      pages = ((await req.json()) as { pages: Page[] }).pages;
    } else {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof Blob)) return json({ error: "Файл не передан" }, 400);
      const name = (file as File).name?.toLowerCase() ?? "";
      const buf = await file.arrayBuffer();
      const isPdf = name.endsWith(".pdf") || new Uint8Array(buf.slice(0, 4)).every((b, i) => b === [0x25, 0x50, 0x44, 0x46][i]);
      pages = isPdf ? await pdfToPages(new Uint8Array(buf)) : xlsxToPages(buf);
    }
    return json(parseMer(pages, year));
  } catch (e) {
    return json({ error: `Не удалось прочитать файл: ${e instanceof Error ? e.message : String(e)}` }, 400);
  }
}
