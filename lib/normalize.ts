/** Нормализация кодов и чисел из выгрузок */

export function normOkpd2(v: unknown): string | null {
  if (v == null) return null;
  const m = String(v).replace(/\s/g, "").replace(/,/g, ".").match(/\d{2}(?:\.\d+)*/);
  return m ? m[0].replace(/\.+$/, "") : null;
}

/**
 * Регион по ОКАТО: самый длинный совпавший код справочника (учитывает ХМАО, ЯНАО, НАО).
 * Кода нет в справочнике — null: регион не угадывается.
 */
export function normRegion(v: unknown, regionCodes: string[]): string | null {
  if (v == null) return null;
  const digits = String(v).replace(/\D/g, "");
  if (digits.length < 2) return null;
  let best: string | null = null;
  for (const c of regionCodes) if (digits.startsWith(c) && (!best || c.length > best.length)) best = c;
  if (!best) return null;
  // 71160 начинается с 71 (Тюменская область), но «711…» — коды автономных округов: такого округа нет — ошибка, а не Тюменская область
  if (best.length === 2 && digits.length >= 5 && regionCodes.some((c) => c.length > 2 && c.startsWith(digits.slice(0, 3)))) return null;
  return best;
}

const regionWords = (s: string) =>
  s.toLowerCase().replace(/ё/g, "е").replace(/\bг\.|город(а)? федерального значения|город|федерального значения|автономн\S*|округ|област\S*|кра[йя]|республик\S*|[—–\-().,]/g, " ")
    .split(/\s+/).filter((w) => w.length >= 3);

/** Регион по названию: все значимые слова названия из справочника есть в тексте. Не узнали — null */
export function regionByName(name: string | null, regions: { code: string; name: string }[]): string | null {
  if (!name) return null;
  const words = new Set(regionWords(name).map((w) => w.slice(0, 6)));
  let best: { code: string; n: number } | null = null;
  for (const r of regions) {
    const need = regionWords(r.name).map((w) => w.slice(0, 6));
    if (need.length && need.every((w) => words.has(w)) && (!best || need.length > best.n)) best = { code: r.code, n: need.length };
  }
  return best?.code ?? null;
}

/**
 * Регион строки: код ОКАТО сверяется с названием региона из соседней колонки.
 * Код неизвестен или не совпадает с названием, но название узнаётся — регион берётся по названию с пометкой;
 * ни код, ни название не узнаются — ошибка, строка не входит в расчёт
 */
export function resolveRegion(v: unknown, name: string | null, regions: { code: string; name: string }[]): { code: string | null; error: string | null; note: string | null } {
  const raw = v == null ? "" : String(v).replace(/\D/g, "");
  const byName = regionByName(name, regions);
  if (!raw) return { code: byName, error: null, note: null };
  const code = normRegion(raw, regions.map((r) => r.code));
  const nameOf = (c: string) => regions.find((r) => r.code === c)?.name ?? c;
  if (!code) return byName
    ? { code: byName, error: null, note: `Код ОКАТО ${raw} нет в справочнике — регион взят по названию «${name}»` }
    : { code: null, error: `Код ОКАТО ${raw} не найден в справочнике регионов${name ? `, название «${name}» тоже не распознано` : ""}`, note: null };
  if (byName && byName !== code) return { code: byName, error: null, note: `Код ОКАТО ${raw} (${nameOf(code)}) не совпадает с регионом «${name}» — взят регион по названию` };
  return { code, error: null, note: null };
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
