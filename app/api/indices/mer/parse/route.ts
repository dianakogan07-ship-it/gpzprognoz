import { NextRequest } from "next/server";
import { json } from "@/lib/api";
import { parseMer } from "@/lib/mer/parse";
import { xlsxToPages } from "@/lib/mer/xlsx";
import { pdfToPages } from "@/lib/mer/pdf";
import type { Page } from "@/lib/mer/grid";
import { pickMerFiles, unpackArchive } from "@/lib/mer/archive";

const isPdfData = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
/** 7z, zip, rar — по сигнатуре */
const isArchive = (b: Uint8Array) => (b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc) || (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 && !isXlsxZip(b)) || (b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72);
/** XLSX — тоже zip; отличаем по содержимому */
const isXlsxZip = (b: Uint8Array) => new TextDecoder("latin1").decode(b.slice(0, 2000)).includes("[Content_Types].xml") || new TextDecoder("latin1").decode(b.slice(0, 200)).includes("xl/");

async function toPages(name: string, data: Uint8Array): Promise<Page[]> {
  if (/\.pdf$/i.test(name) || isPdfData(data)) return pdfToPages(data);
  return xlsxToPages(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
}

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
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
    let archiveName = "";
    if (req.headers.get("content-type")?.includes("application/json")) {
      pages = ((await req.json()) as { pages: Page[] }).pages;
    } else {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof Blob)) return json({ error: "Файл не передан" }, 400);
      const name = (file as File).name?.toLowerCase() ?? "";
      const data = new Uint8Array(await file.arrayBuffer());
      if (/\.(7z|zip|rar)$/i.test(name) || isArchive(data)) {
        archiveName = (file as File).name ?? "";
        const files = pickMerFiles(await unpackArchive(data));
        if (!files.length) return json({ error: "В архиве нет таблиц Excel или PDF" }, 400);
        pages = [];
        for (const f of files) {
          const short = f.name.split("/").pop()!;
          for (const p of await toPages(f.name, f.data)) pages.push({ ...p, label: `${short}, ${p.label}` });
        }
      } else pages = await toPages(name, data);
    }
    const res = parseMer(pages, year);
    // В архиве таблиц МЭР нет титульного листа — название берём из имени файла, его можно поправить в предпросмотре
    if (!res.title) res.title = `Прогноз социально-экономического развития, Минэкономразвития (${archiveName || "таблицы"})`;
    return json(res);
  } catch (e) {
    return json({ error: `Не удалось прочитать файл: ${e instanceof Error ? e.message : String(e)}` }, 400);
  }
}
