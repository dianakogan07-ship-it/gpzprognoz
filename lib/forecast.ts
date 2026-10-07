import type { GpzRow, ReportRow } from "./parse";
import { isActiveIndex, type PriceIndex, type Reference } from "./types";

export interface ForecastOptions { baseYear: number; targetYear: number }

export interface ForecastRow {
  okpd2: string;
  okpd2Name: string;
  category: string | null;
  ws: string | null;
  subject: string;
  unit: string;
  /** Обозначение единицы для показа: «шт», «компл», «мес» */
  unitLabel: string;
  region: string | null;
  regionName: string | null;
  contracts: number;
  outliers: number;
  minPrice: number;
  maxPrice: number;
  /** Медиана цены за единицу без НДС, доведённая до декабря базового года */
  basePrice: number;
  forecastIndex: number;
  indexLevel: "okpd2" | "okved2" | "cpi";
  indexSource: string;
  indexSourceUrl: string;
  forecastPrice: number;
  /** Цены за единицу без НДС по договорам, вошедшим в медиану (до пересчёта на декабрь) */
  prices: number[];
  /** Медиана этих цен до пересчёта на декабрь */
  rawMedian: number;
  /** Цены, исключённые как выбросы (после пересчёта на декабрь) */
  outlierPrices: number[];
  /** Пересчёт до декабря: применён ко всем / к части / ни к одному / не требовался (договоры декабря) */
  toDecember: "applied" | "partial" | "none" | "not_needed";
  indexKey: string | null;
  indexApproved: boolean | null;
  indexSourceCode: string | null;
  repeatable: boolean | null;
  needsApproval: boolean;
  smallSample: boolean;
  flags: string[];
  comment: string;
}
export interface ExcludedRow { file: "ГПЗ" | "Отчётность"; row: number; lot: string | null; reason: string }
export interface ForecastResult { rows: ForecastRow[]; excluded: ExcludedRow[]; newWsCodes: string[]; stats: { gpz: number; matched: number; used: number } }

const NOT_CONCLUDED = /(не\s*(заключ|размещ|заверш|состоял))|отмен|аннулир/i;
const OUTLIER_FACTOR = 2;
const SMALL_SAMPLE = 3;

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Медиана без выбросов: значения, отличающиеся от исходной медианы более чем в 2 раза, исключаются */
export function robustMedian(xs: number[]) {
  const m0 = median(xs);
  const kept = xs.filter((x) => x <= m0 * OUTLIER_FACTOR && x >= m0 / OUTLIER_FACTOR);
  return { value: median(kept), kept, outliers: xs.length - kept.length };
}

export function okvedSection(okpd2: string, ref: Reference): string | null {
  const div = Number(okpd2.slice(0, 2));
  return ref.okved2.find((s) => div >= s.div_from && div <= s.div_to)?.letter ?? null;
}

/** Индекс с самым длинным совпавшим префиксом ОКПД2, затем по разделу ОКВЭД2 */
export function findIndex(list: PriceIndex[], okpd2: string, section: string | null) {
  let best: PriceIndex | null = null;
  for (const ix of list) {
    if (!ix.key || !/^\d/.test(ix.key)) continue;
    if ((okpd2 === ix.key || okpd2.startsWith(ix.key + ".") || (ix.key.length === 2 && okpd2.startsWith(ix.key))) && (!best || ix.key.length > best.key!.length)) best = ix;
  }
  if (best) return { index: best, level: "okpd2" as const };
  const bySection = section ? list.find((ix) => ix.key === section) : undefined;
  return bySection ? { index: bySection, level: "okved2" as const } : null;
}

export function findRepeatable(ref: Reference, okpd2: string, ws: string | null): boolean | null {
  if (ws) {
    const r = ref.repeatRules.find((x) => x.kind === "ws" && x.prefix === ws);
    if (r) return r.repeatable;
  }
  let best: { prefix: string; repeatable: boolean } | null = null;
  for (const r of ref.repeatRules) {
    if (r.kind !== "okpd2") continue;
    if ((okpd2 === r.prefix || okpd2.startsWith(r.prefix + ".") || (r.prefix.length === 2 && okpd2.startsWith(r.prefix))) && (!best || r.prefix.length > best.prefix.length)) best = r;
  }
  return best ? best.repeatable : null;
}

const pct = (k: number) => `${k >= 1 ? "+" : ""}${((k - 1) * 100).toFixed(1).replace(".", ",")}%`;
const round2 = (x: number) => Math.round(x * 100) / 100;

export function buildForecast(gpz: GpzRow[], report: ReportRow[], ref: Reference, opt: ForecastOptions): ForecastResult {
  const excluded: ExcludedRow[] = [];
  const byLot = new Map<string, ReportRow>();
  const byProc = new Map<string, ReportRow>();
  for (const r of report) {
    if (r.lot) byLot.set(r.lot, r);
    if (r.procId && !byProc.has(r.procId)) byProc.set(r.procId, r);
  }
  const sourceByCode = new Map(ref.sources.map((s) => [s.code, s]));
  const active = ref.indices.filter(isActiveIndex);
  const toDec = active.filter((i) => i.kind === "to_december" && i.year === opt.baseYear);
  const fc = active.filter((i) => i.kind === "forecast" && i.year === opt.targetYear);
  const cpi = active.find((i) => i.kind === "cpi" && i.year === opt.targetYear) ?? null;
  const knownWs = new Set(ref.ws.map((w) => w.code));
  const newWs = new Set<string>();

  type Item = { g: GpzRow; raw: number; price: number; adjusted: boolean; needed: boolean };
  const groups = new Map<string, Item[]>();
  let matched = 0;

  for (const g of gpz) {
    const rep = (g.lot && byLot.get(g.lot)) || (g.procId && byProc.get(g.procId)) || null;
    const ex = (reason: string) => excluded.push({ file: "ГПЗ", row: g.row, lot: g.lot ?? g.procId, reason });
    if (!rep) { ex("Нет в отчётности (договор не заключён)"); continue; }
    matched++;
    const ws = g.ws ?? rep.ws;
    if (ws && !knownWs.has(ws)) newWs.add(ws);
    if (rep.status && NOT_CONCLUDED.test(rep.status)) { ex(`Договор не заключён: «${rep.status}»`); continue; }
    if (rep.priceNoVat == null || rep.priceNoVat <= 0) { ex("Нет фактической цены договора"); continue; }
    if (!g.okpd2) { ex("Не указан ОКПД2"); continue; }
    const qty = rep.quantity ?? g.quantity;
    if (!qty || qty <= 0) { ex("Не указано количество"); continue; }
    if (!g.unit && !g.unitName) { ex("Не указана единица измерения"); continue; }

    const raw = rep.priceNoVat / qty;
    let price = raw;
    let adjusted = true;
    const month = rep.contractDate ? rep.contractDate.getUTCMonth() + 1 : null;
    if (month !== 12) {
      const cand = month ? toDec.filter((i) => i.month === month) : [];
      const hit = findIndex(cand, g.okpd2, okvedSection(g.okpd2, ref));
      if (hit) price *= hit.index.value;
      else adjusted = false;
    }
    const unit = unitLabel(g.unitName ?? g.unit, ref);
    const key = [g.okpd2, unit, g.region ?? "", ws ?? ""].join("|");
    const item = { g: { ...g, ws, unit }, raw, price, adjusted, needed: month !== 12 };
    groups.get(key)?.push(item) ?? groups.set(key, [item]);
  }

  const okpdName = (code: string) => {
    for (let c = code; c; c = c.includes(".") ? c.slice(0, c.lastIndexOf(".")) : c.length > 2 ? c.slice(0, 2) : "") {
      const hit = ref.okpd2.find((o) => o.code === c);
      if (hit) return hit.name;
    }
    return "";
  };

  const rows: ForecastRow[] = [];
  for (const items of groups.values()) {
    const g0 = items[0].g;
    const okpd2 = g0.okpd2!;
    const { value: base, kept, outliers } = robustMedian(items.map((i) => i.price));
    const m0 = median(items.map((i) => i.price));
    const keptItems = items.filter((i) => i.price <= m0 * OUTLIER_FACTOR && i.price >= m0 / OUTLIER_FACTOR);
    const outlierPrices = items.filter((i) => !keptItems.includes(i)).map((i) => round2(i.price));
    const needed = items.filter((i) => i.needed);
    const toDecember: ForecastRow["toDecember"] = !needed.length ? "not_needed"
      : needed.every((i) => i.adjusted) ? "applied" : needed.some((i) => i.adjusted) ? "partial" : "none";
    const flags: string[] = [];
    const notes: string[] = [];
    const smallSample = items.length < SMALL_SAMPLE;
    if (smallSample) flags.push("малая выборка");
    if (outliers) notes.push(`исключено выбросов: ${outliers}`);
    const notAdjusted = items.filter((i) => i.adjusted === false).length;
    if (notAdjusted) { flags.push("не доведено до декабря"); notes.push(`для ${notAdjusted} дог. нет индекса ИЦП за месяц заключения — цена взята без доведения до декабря`); }

    let needsApproval = false;
    let k = 1, level: ForecastRow["indexLevel"] = "cpi", src = "";
    const hit = findIndex(fc, okpd2, okvedSection(okpd2, ref));
    let used: PriceIndex | null = hit?.index ?? null;
    if (hit) {
      level = hit.level;
      notes.push(level === "okpd2" ? `индекс по ОКПД2 ${hit.index.key}` : `индекс по разделу ОКВЭД2 ${hit.index.key}`);
    } else {
      used = cpi;
      needsApproval = true;
      notes.push(cpi ? "индекс по ОКПД2/ОКВЭД2 не найден — применён прогноз ИПЦ" : "нет ни отраслевого индекса, ни прогноза ИПЦ — цена не индексирована");
    }
    if (used) {
      k = used.value;
      const s = used.source_code ? sourceByCode.get(used.source_code) : undefined;
      src = s?.name ?? used.source_code ?? "";
      if (!used.approved) { needsApproval = true; notes.push("индекс не утверждён"); }
    }
    if (needsApproval) flags.push("требует согласования");

    const repeatable = findRepeatable(ref, okpd2, g0.ws);
    if (repeatable === false) { flags.push("ориентир справочный"); notes.push("разовая закупка"); }
    if (repeatable === null) notes.push("повторяемость не определена");

    const subjects = items.map((i) => i.g.subject).filter(Boolean) as string[];
    const name = okpdName(okpd2);
    rows.push({
      okpd2, okpd2Name: name,
      category: g0.category, ws: g0.ws,
      subject: name || anonymize(subjects[0] ?? ""),
      unit: g0.unit!, unitLabel: g0.unit!, region: g0.region,
      regionName: ref.regions.find((r) => r.code === g0.region)?.name ?? null,
      contracts: items.length, outliers,
      minPrice: round2(Math.min(...kept)), maxPrice: round2(Math.max(...kept)),
      basePrice: round2(base),
      forecastIndex: k, indexLevel: level, indexSource: src,
      indexSourceUrl: used?.source_code ? sourceByCode.get(used.source_code)?.url ?? "" : "",
      forecastPrice: round2(base * k),
      prices: keptItems.map((i) => round2(i.raw)).sort((a, b) => a - b),
      rawMedian: round2(median(keptItems.map((i) => i.raw))),
      outlierPrices,
      toDecember,
      indexKey: used?.key ?? null,
      indexApproved: used ? used.approved : null,
      indexSourceCode: used?.source_code ?? null,
      repeatable, needsApproval, smallSample, flags,
      comment: [`Медиана ${items.length - outliers} дог. ${round2(base)} ₽ → ${pct(k)}`, ...notes].join("; "),
    });
  }
  rows.sort((a, b) => a.okpd2.localeCompare(b.okpd2) || a.unit.localeCompare(b.unit));
  const gLots = new Set(gpz.map((g) => g.lot).filter(Boolean));
  const gProcs = new Set(gpz.map((g) => g.procId).filter(Boolean));
  for (const r of report) {
    if (!(r.lot && gLots.has(r.lot)) && !(r.procId && gProcs.has(r.procId))) excluded.push({ file: "Отчётность", row: r.row, lot: r.lot ?? r.procId, reason: "Нет в ГПЗ" });
  }
  return { rows, excluded, newWsCodes: [...newWs].sort(), stats: { gpz: gpz.length, matched, used: rows.reduce((s, r) => s + r.contracts, 0) } };
}

/** Обозначение единицы: код ОКЕИ или полное наименование переводятся в краткое («796» → «шт», «Комплект» → «компл») */
export function unitLabel(v: string | null, ref: Pick<Reference, "okei">): string {
  const s = (v ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!s) return "";
  const byCode = /^\d+$/.test(s) ? ref.okei.find((o) => o.code === s.padStart(3, "0")) : undefined;
  const hit = byCode ?? ref.okei.find((o) => o.name.toLowerCase() === s || o.short.toLowerCase() === s);
  return hit ? hit.short : s;
}

/** Убирает из текста предмета наименования организаций и ИНН */
export function anonymize(s: string): string {
  return s
    .replace(/(^|\s)(ООО|АО|ПАО|ЗАО|ОАО|ИП|ФГУП|МУП|ГУП)\s*[«"][^»"]*[»"]/g, "$1")
    .replace(/[«"][^»"]*[»"]/g, "")
    .replace(/ИНН\s*\d+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
