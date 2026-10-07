import * as XLSX from "xlsx";
import { cleanText, type Page } from "./grid";

/** Листы Excel → страницы: каждая непустая ячейка с номером колонки как x. Объединённые ячейки заголовков размножаются */
export function xlsxToPages(buf: ArrayBuffer): Page[] {
  const wb = XLSX.read(buf, { type: "array" });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: null, blankrows: true });
    // Объединённые ячейки по горизонтали (годы над подколонками вариантов) — текст в каждой подколонке
    for (const m of ws["!merges"] ?? []) {
      const r = m.s.r - XLSX.utils.decode_range(ws["!ref"] ?? "A1").s.r;
      const v = grid[r]?.[m.s.c];
      if (v == null || m.s.r !== m.e.r) continue;
      for (let c = m.s.c + 1; c <= m.e.c; c++) if (grid[r][c] == null) grid[r][c] = v;
    }
    return {
      label: `лист «${name}»`,
      tolerance: 0.4,
      rows: grid.map((row) => ({
        cells: (row ?? []).flatMap((v, x) => {
          const text = v == null ? "" : cleanText(String(v));
          return text ? [{ text, x }] : [];
        }),
      })).filter((r) => r.cells.length),
    };
  });
}
