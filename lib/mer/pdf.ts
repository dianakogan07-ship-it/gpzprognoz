import { cleanText, type Cell, type Page } from "./grid";

interface TextItem { str: string; transform: number[]; width: number; height: number }

/**
 * PDF → страницы со строками. Текст группируется в строки по вертикали,
 * соседние куски текста в строке склеиваются в одну ячейку, если между ними маленький зазор.
 */
export async function pdfToPages(data: Uint8Array, keep?: (rowsText: string) => boolean): Promise<Page[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined") pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  else {
    // На сервере обработчик подключаем заранее: pdf.js возьмёт его из globalThis и не будет искать файл сам
    const g = globalThis as { pdfjsWorker?: unknown };
    g.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  }
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
  const pages: Page[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as TextItem[]).filter((i) => typeof i.str === "string" && i.str.trim());
    const rows = itemsToRows(items);
    if (!keep || keep(rows.map((r) => r.cells.map((c) => c.text).join(" ")).join("\n"))) pages.push({ label: `стр. ${p}`, rows, tolerance: 14 });
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}

export function itemsToRows(items: TextItem[]): Page["rows"] {
  const sorted = items
    .map((i) => ({ text: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || i.height || 8 }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: (typeof sorted)[] = [];
  for (const it of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y - it.y) <= Math.max(2, it.h * 0.4)) line.push(it);
    else lines.push([it]);
  }
  return lines.map((line) => {
    line.sort((a, b) => a.x - b.x);
    const cells: (Cell & { right: number; h: number; left: number })[] = [];
    for (const it of line) {
      const last = cells[cells.length - 1];
      const gap = last ? it.x - last.right : Infinity;
      // Зазор меньше ширины пробела — продолжение того же текста
      // Числа склеиваем, только если они вплотную: «202» + «7» → «2027»
      if (last && ((gap < it.h * 0.6 && !(isNum(last.text) && isNum(it.text))) || gap < it.h * 0.15)) {
        last.text += (gap > it.h * 0.15 ? " " : "") + it.text;
        last.right = it.x + it.w;
      } else cells.push({ text: it.text, x: 0, left: it.x, right: it.x + it.w, h: it.h });
    }
    return { cells: cells.map((c) => ({ text: cleanText(c.text), x: (c.left + c.right) / 2 })).filter((c) => c.text) };
  }).filter((r) => r.cells.length);
}

const isNum = (s: string) => /^[-−–]?\d+([.,]\d+)?$/.test(s.trim());
