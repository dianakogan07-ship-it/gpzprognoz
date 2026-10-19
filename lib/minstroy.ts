import * as XLSX from "xlsx";
import { regionByName } from "./normalize";

/** Файл ФГИС ЦС «Индексы изменения сметной стоимости к группам однородных строительных ресурсов» по одному региону и кварталу */
export interface MinstroyFile {
  file: string;
  /** Ценовая зона из шапки: «Ханты-Мансийский автономный округ - Югра (1 зона), г. Нижневартовск» */
  zone: string;
  region: string | null;
  quarter: number;
  year: number;
  /** Код ресурса → [сметная цена 2022, индекс]; материалы и машины вместе */
  items: Map<string, [number, number]>;
  materials: number;
  machines: number;
}

export function parseMinstroy(buf: ArrayBuffer, file: string, regions: { code: string; name: string }[]): MinstroyFile {
  const wb = XLSX.read(buf, { type: "array" });
  let zone = "", quarter = 0, year = 0, materials = 0, machines = 0;
  const items = new Map<string, [number, number]>();
  for (const name of wb.SheetNames) {
    const g = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: null });
    const title = String(g[0]?.[0] ?? "").replace(/\s+/g, " ");
    const q = title.match(/на\s+(\d)\s+квартал\S*\s+(\d{4})/i);
    if (!q || !/индекс\S* изменени\S* сметн/i.test(title)) continue;
    quarter = Number(q[1]); year = Number(q[2]);
    zone = title.match(/ценов\S* зоны\s+(.+?)\s+на\s+\d\s+квартал/i)?.[1]?.trim() ?? zone;
    // Шапка таблицы — строка с колонкой «Индекс…» под заголовком файла
    const hi = g.findIndex((r, i) => i > 0 && (r ?? []).some((c) => /^индекс/i.test(String(c ?? "").trim())));
    if (hi < 0) continue;
    const h = g[hi].map((c) => String(c ?? "").replace(/\s+/g, " "));
    const ix = h.findIndex((c) => /^индекс/i.test(c.trim()));
    const pc = h.findIndex((c) => /сметн\S* цен/i.test(c));
    for (const r of g.slice(hi + 1)) {
      const code = r?.[0], v = r?.[ix], p = r?.[pc];
      if (typeof code !== "string" || !/^\d/.test(code) || typeof v !== "number" || !(v > 0)) continue;
      items.set(code, [typeof p === "number" ? p : 0, v]);
      if (/машин/i.test(name)) machines++; else materials++;
    }
  }
  if (!items.size) throw new Error(`${file}: не похоже на файл ФГИС ЦС с индексами к группам однородных строительных ресурсов`);
  return { file, zone, region: regionByName(zone.replace(/\(.*$/, ""), regions), quarter, year, items, materials, machines };
}

/**
 * Рост сметной стоимости за год: корзина ресурсов, общих в обоих файлах, со сметными ценами 2022 года как весами.
 * Σ цена × индекс нового квартала / Σ цена × индекс того же квартала годом раньше
 */
export function minstroyGrowth(prev: MinstroyFile, cur: MinstroyFile) {
  let a = 0, b = 0, n = 0;
  for (const [code, [p, v]] of cur.items) {
    const o = prev.items.get(code);
    if (!o || !(p > 0)) continue;
    a += p * o[1]; b += p * v; n++;
  }
  return { value: a ? b / a : null, common: n };
}

/** Пары файлов одной ценовой зоны: последний квартал и тот же квартал годом раньше */
export function pairMinstroy(files: MinstroyFile[]) {
  const byZone = new Map<string, MinstroyFile[]>();
  for (const f of files) byZone.set(f.zone, [...(byZone.get(f.zone) ?? []), f]);
  return [...byZone.entries()].map(([zone, fs]) => {
    const sorted = [...fs].sort((x, y) => y.year * 4 + y.quarter - (x.year * 4 + x.quarter));
    const cur = sorted[0];
    const prev = sorted.find((f) => f.quarter === cur.quarter && f.year === cur.year - 1) ?? null;
    const g = prev ? minstroyGrowth(prev, cur) : null;
    return { zone, region: cur.region, cur, prev, value: g?.value ?? null, common: g?.common ?? 0 };
  });
}

/** Рост по регионам: если загружено несколько ценовых зон одного региона — среднее по зонам */
export function minstroyByRegion(files: MinstroyFile[]) {
  const pairs = pairMinstroy(files);
  const m = new Map<string, typeof pairs>();
  for (const p of pairs) { const k = p.region ?? `?${p.zone}`; m.set(k, [...(m.get(k) ?? []), p]); }
  return [...m.entries()].map(([k, ps]) => {
    const ok = ps.filter((p) => p.value != null);
    return {
      region: k.startsWith("?") ? null : k, zones: ps,
      value: ok.length ? ok.reduce((s, p) => s + p.value!, 0) / ok.length : null,
      period: ok[0] ? `${ok[0].cur.quarter} кв. ${ok[0].cur.year} к ${ok[0].prev!.quarter} кв. ${ok[0].prev!.year}` : null,
    };
  });
}
