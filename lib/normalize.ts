/** Нормализация кодов и чисел из выгрузок */

export function normOkpd2(v: unknown): string | null {
  if (v == null) return null;
  const m = String(v).replace(/\s/g, "").replace(/,/g, ".").match(/\d{2}(?:\.\d+)*/);
  return m ? m[0].replace(/\.+$/, "") : null;
}

/** Регион по ОКАТО: самый длинный совпавший код справочника (учитывает ХМАО, ЯНАО, НАО) */
export function normRegion(v: unknown, regionCodes: string[]): string | null {
  if (v == null) return null;
  const digits = String(v).replace(/\D/g, "");
  if (digits.length < 2) return null;
  let best: string | null = null;
  for (const c of regionCodes) if (digits.startsWith(c) && (!best || c.length > best.length)) best = c;
  return best ?? digits.slice(0, 2);
}

export function normWs(v: unknown): string | null {
  if (v == null) return null;
  const m = String(v).toUpperCase().match(/WS\s*\d+/);
  return m ? m[0].replace(/\s/g, "") : null;
}

export function toNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[\s ₽]|руб\.?/gi, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Ставка НДС из текста: «22%», «НДС 10 %», «Без НДС» → 0 */
export function parseVatRate(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v > 1 ? v / 100 : v;
  const s = String(v).toLowerCase();
  if (s.includes("без")) return 0;
  const m = s.match(/(\d+(?:[.,]\d+)?)/);
  return m ? Number(m[1].replace(",", ".")) / 100 : null;
}

export function toDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(+v) ? null : v;
  if (typeof v === "number") return new Date(Math.round((v - 25569) * 864e5)); // серийная дата Excel
  const m = String(v).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  const d = new Date(String(v));
  return isNaN(+d) ? null : d;
}

export const normUnit = (v: unknown) => (v == null ? null : String(v).trim().toLowerCase().replace(/\.$/, "") || null);
export const normKey = (v: unknown) => (v == null ? null : String(v).trim().replace(/\s+/g, "") || null);
