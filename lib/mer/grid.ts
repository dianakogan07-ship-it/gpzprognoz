/**
 * Документ в виде страниц со строками и ячейками.
 * Для PDF x — координата центра текста на странице, для Excel — номер колонки.
 */
export interface Cell { text: string; x: number }
export interface Row { cells: Cell[] }
export interface Page {
  /** «стр. 12» или «лист «Табл.3»» */
  label: string;
  rows: Row[];
  /** Допуск по x при сопоставлении значения с колонкой года */
  tolerance?: number;
}

export const cleanText = (s: string) => s.replace(/[   ]/g, " ").replace(/\s+/g, " ").trim();
