"use client";
/**
 * Выгрузка страницы в PDF: каждый лист с data-pdf снимается картинкой и занимает одну страницу A4 альбомной ориентации.
 */
export async function exportPdf(root: HTMLElement, filename: string, background = "#FFFFFF") {
  const [{ toPng }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const PW = 297, PH = 210, M = 8, W = PW - M * 2, H = PH - M * 2 - 4;
  const sheets = [...root.querySelectorAll<HTMLElement>("[data-pdf]")].filter((el) => el.getBoundingClientRect().height > 0);
  const fontEmbedCSS = await fontCss();
  const ratio = 2;
  for (let i = 0; i < sheets.length; i++) {
    const url = await toPng(sheets[i], {
      pixelRatio: ratio, backgroundColor: background, ...(fontEmbedCSS ? { fontEmbedCSS } : { skipFonts: true }),
      filter: (n) => !(n instanceof HTMLElement && n.dataset.pdfSkip !== undefined),
    });
    const img = await loadImage(url);
    // Лист целиком на страницу: вписываем по ширине или высоте, без нарезки
    const k = Math.min(W / img.width, H / img.height);
    const w = img.width * k, h = img.height * k;
    if (i > 0) pdf.addPage();
    pdf.addImage(url, "PNG", M + (W - w) / 2, M, w, h);
    pdf.setFontSize(8);
    pdf.setTextColor(125, 132, 154);
    pdf.text(`${i + 1} / ${sheets.length}`, PW - M, PH - 5, { align: "right" });
  }
  pdf.save(filename);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
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
