"use client";
/**
 * Выгрузка страницы в PDF: каждый блок с data-pdf снимается картинкой и раскладывается по листам A4 альбомной ориентации.
 * Высокий блок режется по строкам с data-pdf-row, чтобы группа не разрывалась между листами.
 */
export async function exportPdf(root: HTMLElement, filename: string, background = "#FFFFFF") {
  const [{ toCanvas }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const PW = 297, PH = 210, M = 10, FOOT = 6, W = PW - M * 2, BOTTOM = PH - M - FOOT, H = BOTTOM - M, GAP = 5;
  let y = M;
  const blocks = [...root.querySelectorAll<HTMLElement>("[data-pdf]")];
  const fontEmbedCSS = await fontCss();
  const ratio = 2;
  for (const block of blocks) {
    const rect = block.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    // Блок с data-pdf-page начинается с нового листа
    if (block.dataset.pdfPage !== undefined && y > M) { pdf.addPage(); y = M; }
    const canvas = await toCanvas(block, {
      pixelRatio: ratio, backgroundColor: background, ...(fontEmbedCSS ? { fontEmbedCSS } : { skipFonts: true }),
      // Внешние отступы блока (space-y и т. п.) в снимке сдвигают содержимое и обрезают низ — убираем
      style: { margin: "0" },
      filter: (n) => !(n instanceof HTMLElement && n.dataset.pdfSkip !== undefined),
    });
    // Размеры берём с картинки: при снимке строки могут переноситься чуть иначе, чем на экране
    const pxW = canvas.width / ratio, pxH = canvas.height / ratio;
    const k = W / pxW; // мм на пиксель
    const h = pxH * k;
    const place = (src: string, hh: number) => {
      if (y + hh > BOTTOM && y > M) { pdf.addPage(); y = M; }
      pdf.addImage(src, "JPEG", M, y, W, hh, undefined, "FAST");
      y += hh + GAP;
    };
    if (h <= H) { place(canvas.toDataURL("image/jpeg", 0.92), h); continue; }
    // Режем по строкам с data-pdf-row; их положение пересчитываем в масштаб картинки
    const sy = pxH / rect.height;
    const cuts = [...block.querySelectorAll<HTMLElement>("[data-pdf-row]")].map((el) => (el.getBoundingClientRect().top - rect.top) * sy).filter((c) => c > 0);
    let from = 0;
    while (from < pxH - 1) {
      const room = (y > M ? BOTTOM - y : H) / k;
      let to = Math.min(pxH, from + room);
      if (to < pxH) {
        const fit = cuts.filter((c) => c > from + 1 && c <= to);
        if (fit.length) to = fit[fit.length - 1] - 2;
        else if (y > M) { pdf.addPage(); y = M; continue; }
      }
      place(crop(canvas, from * ratio, (to - from) * ratio), (to - from) * k);
      from = to;
    }
  }
  // Номера страниц
  const n = pdf.getNumberOfPages();
  if (n > 1) {
    pdf.setFontSize(8);
    pdf.setTextColor(150);
    for (let i = 1; i <= n; i++) { pdf.setPage(i); pdf.text(`${i} / ${n}`, PW - M, PH - M + 1, { align: "right" }); }
  }
  pdf.save(filename);
}

function crop(src: HTMLCanvasElement, top: number, height: number) {
  const c = document.createElement("canvas");
  c.width = src.width; c.height = Math.max(1, Math.round(height));
  c.getContext("2d")!.drawImage(src, 0, Math.round(top), src.width, c.height, 0, 0, src.width, c.height);
  return c.toDataURL("image/jpeg", 0.92);
}

let fontCache: Promise<string> | null = null;
/** Шрифты страницы (Google Fonts) со встроенными файлами — чтобы в снимке строки переносились так же, как на экране */
function fontCss() {
  fontCache ??= (async () => {
    const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href*="fonts.googleapis.com"]')];
    let out = "";
    for (const l of links) {
      const css = await (await fetch(l.href)).text();
      // Только кириллица и латиница — остальные наборы не нужны
      const faces = css.split("}").filter((f) => /@font-face/.test(f) && /U\+0000-00FF|U\+0301, U\+0400-045F/.test(f));
      for (const face of faces) {
        const m = face.match(/url\((https:[^)]+)\)/);
        if (!m) continue;
        const buf = await (await fetch(m[1])).arrayBuffer();
        let bin = ""; const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        out += face.replace(m[1], `data:font/woff2;base64,${btoa(bin)}`) + "}\n";
      }
    }
    return out;
  })().catch(() => "");
  return fontCache;
}
