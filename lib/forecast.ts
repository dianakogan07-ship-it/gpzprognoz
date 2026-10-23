import type { GpzRow, ReportRow } from "./parse";
import { isActiveIndex, type PriceIndex, type Reference } from "./types";

export interface ForecastOptions {
  baseYear: number;
  targetYear: number;
  /** Применять ставки НДС из файлов, отличные от 22 %, — только после подтверждения пользователем */
  trustVat?: boolean;
}

/** Ставка НДС по умолчанию */
export const DEFAULT_VAT = 0.22;

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
  /** Чем посчитан рост: отраслевой индекс, общая инфляция, рост зарплат (трудоёмкие услуги), курс валюты (валютные договоры), индекс Минстроя региона */
  indexLevel: "okpd2" | "okved2" | "cpi" | "wage" | "fx" | "minstroy";
  /** Рост в консервативном сценарии МЭР; нет консервативного индекса — равен базовому */
  forecastIndexCons?: number;
  /** Валюта договоров группы (USD, EUR, CNY); рублёвые — пусто */
  currency?: string | null;
  /** Отраслевой индекс был отрицательным (значение) — взята инфляция */
  indexFloored?: number | null;
  /** Договоров, стоимость которых поделена между базовым и следующим годом */
  apportioned?: number;
  /** Договоров, у которых регион взят по названию — код ОКАТО в файле неверный */
  regionFixed?: number;
  /** Медиана НМЦ 2026 за единицу без НДС и сумма НМЦ по договорам группы — для варианта «от НМЦ» и экономии на торгах */
  nmcMedian?: number | null;
  nmcSum?: number | null;
  /** Сумма договоров группы, по которым известна НМЦ — для честного сравнения с nmcSum */
  nmcContractSum?: number | null;
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
  /** Ставка НДС из ГПЗ (или отчётности), доля: 0.22; нет в файлах — null */
  vatRate?: number | null;
  /** Способ закупки — самый частый в группе */
  method?: string | null;
  /** Ставка НДС из файла, отличная от 22 %, которую пользователь не подтвердил: в расчёте взята 22 % */
  vatFile?: number | null;
  /** Наименования предмета из ГПЗ (обезличенные), самые частые первыми */
  gpzNames?: string[];
  /** Объём по ГПЗ (сумма количеств договоров группы) */
  volume?: number;
  /** Сумма договоров без НДС, ₽ */
  baseSum?: number;
  /** Та же потребность по ценам прогноза без НДС, ₽ */
  forecastSum?: number;
  /** Название индекса отрасли («Нефтепродукты»), если он найден по ОКПД2 */
  indexName?: string;
  /** Договоров, датированных годом после базового: пересчёт внутри года к ним не применяется */
  laterYear?: number;
  /** Договоры длиннее года */
  longContracts?: number;
  /** Договоры, сумма которых выросла по допсоглашениям относительно предложения победителя: доля роста по каждому */
  dsUp?: number[];
  /** Договоры, действующие весь год прогноза */
  activeTarget?: number;
  /** Количество месяцев в ГПЗ не совпадает со сроком договора: [месяцев в ГПЗ, месяцев по договору] */
  monthMismatch?: [number, number][];
  /** Цена за весь лот (1 единица): не сравнивается между регионами */
  lotPrice?: boolean;
  /** Квартал проведения закупки по плану → число процедур */
  quarters?: number[];
  /** Обезличенные договоры группы: цена за единицу без НДС и месяц заключения — для пересчёта по новым индексам */
  points?: ContractPoint[];
  needsApproval: boolean;
  smallSample: boolean;
  flags: string[];
  comment: string;
}
/** Один договор без сведений о заказчике и контрагенте */
export interface ContractPoint {
  okpd2: string;
  unit: string;
  region: string | null;
  ws: string | null;
  category: string | null;
  method: string | null;
  subject: string;
  /** Цена за единицу без НДС */
  raw: number;
  /** Месяц, на который приходится цена договора, 1–12: месяц заключения, у договоров длиннее года — середина срока */
  month: number | null;
  /** Год этого месяца; нет — считается базовым годом */
  year?: number | null;
  /** Количество по договору */
  qty?: number | null;
  /** Ставка НДС, доля */
  vat?: number | null;
  /** Ставка НДС из файла, если она отличается от 22 % */
  vatFile?: number | null;
  /** Срок договора, месяцев */
  months?: number | null;
  /** Рост суммы договора к предложению победителя (допсоглашения), доля */
  ds?: number | null;
  /** Договор действует до конца года прогноза или дольше */
  active?: boolean;
  /** Месяцев в ГПЗ при единице «месяц» */
  gpzMonths?: number | null;
  /** Квартал проведения закупки по плану */
  quarter?: number | null;
  /** Валюта договора, если закупка валютная */
  currency?: string | null;
  /** НМЦ за единицу без НДС (начальная цена закупки) */
  nmc?: number | null;
  /** Реестровый номер лота или ID процедуры — чтобы найти договор в файле */
  lot?: string | null;
  /** Начало и окончание договора, ГГГГ-ММ-ДД */
  start?: string | null;
  end?: string | null;
  /** Месяцев договора в базовом году (и раньше) и после него — для деления стоимости по годам */
  mBase?: number | null;
  mAfter?: number | null;
  /** Регион взят по названию: код ОКАТО в файле неверный */
  regionFixed?: boolean;
  /** Доля цены, относящаяся к базовому году (договор заходит на следующий год); 1 — весь договор в базовом году */
  share?: number | null;
  /** НМЦ за единицу без НДС из ГПЗ — цена, которую закупщик заложил в план (ручной прогноз) */
  planNmc?: number | null;
}
/** Договор в хранилище — массивом, чтобы строка не разрасталась: [цена, месяц, год, количество, срок, рост по ДС, действует в году прогноза, месяцев в ГПЗ, квартал, ставка НДС из файла, валюта] */
export type PackedPoint = (number | string | null)[];
export const packPoint = (p: Partial<ContractPoint> & { raw: number; month: number | null }): PackedPoint =>
  [p.raw, p.month, p.year ?? null, p.qty ?? null, p.months ?? null, p.ds ?? null, p.active ? 1 : 0, p.gpzMonths ?? null, p.quarter ?? null, p.vatFile ?? null, p.currency ?? null, p.nmc ?? null,
    p.lot ?? null, p.start ?? null, p.end ?? null, p.mBase ?? null, p.mAfter ?? null, p.subject || null, p.regionFixed ? 1 : 0, p.share ?? null, p.planNmc ?? null];
export const unpackPoint = (a: PackedPoint) => {
  const n = (i: number) => (typeof a[i] === "number" ? (a[i] as number) : null);
  return {
    raw: n(0) ?? 0, month: n(1), year: n(2), qty: n(3), months: n(4), ds: n(5),
    active: a[6] === 1, gpzMonths: n(7), quarter: n(8), vatFile: n(9), currency: typeof a[10] === "string" ? a[10] : null, nmc: n(11),
    lot: typeof a[12] === "string" ? a[12] : null, start: typeof a[13] === "string" ? a[13] : null, end: typeof a[14] === "string" ? a[14] : null,
    mBase: n(15), mAfter: n(16), ...(typeof a[17] === "string" ? { subject: a[17] } : {}), regionFixed: a[18] === 1, share: n(19), planNmc: n(20),
  };
};
export interface ExcludedRow {
  file: "ГПЗ" | "Отчётность"; row: number; lot: string | null; reason: string;
  /** Закупка из плана без договора: НМЦ из ГПЗ без НДС и рост цен для её направления — чтобы она вошла в сумму ГПЗ */
  plan?: { nmc: number; okpd2: string | null; category: string | null; region: string | null; subject: string; k: number };
}
export interface ForecastResult {
  rows: ForecastRow[]; excluded: ExcludedRow[]; newWsCodes: string[];
  stats: {
    gpz: number; matched: number; used: number;
    /** Договоров, заключённых позже базового года (например, в 2027 году при отчётности за 2026) */
    laterYear?: number;
    /** Ставки НДС из файлов, отличные от 22 %: ставка → число строк */
    vatOther?: Record<string, number>;
  };
}

/** Трудоёмкие услуги — рост по зарплатам: охрана, уборка, питание, обучение */
export const LABOR = ["80", "81.2", "56", "85"];
/** Строительство и проектирование — индекс Минстроя по региону */
export const CONSTRUCTION = ["41", "42", "43", "71.1"];
/** Валюта из отчётности: «Доллар США», «USD» → USD; рубли и прочерк — нет */
export function normCurrency(v: string | null): string | null {
  const s = (v ?? "").toLowerCase();
  if (/доллар|usd/.test(s)) return "USD";
  if (/евро|eur/.test(s)) return "EUR";
  if (/юан|cny|rmb/.test(s)) return "CNY";
  return null;
}

/** Единицы, при которых количество 1 означает цену всего лота */
const LOT_UNITS = /^(ед|усл\.?\s*ед|услуга|компл|лот)/;
const NOT_CONCLUDED = /(не\s*(заключ|размещ|заверш|состоял))|отмен|аннулир/i;
const OUTLIER_FACTOR = 2;
const SMALL_SAMPLE = 3;

/** Цена по договорам базового года (медиана, без пересчёта внутри года) — от неё считается рост */
export const contractPrice = (r: Pick<ForecastRow, "rawMedian" | "basePrice">) => (r.rawMedian > 0 ? r.rawMedian : r.basePrice);

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

/**
 * Код ОКПД2 входит в группировку: коды иерархичны по цифрам, поэтому 19.2 включает 19.20 и 19.20.21.135,
 * а 19.20 и 19.20.0 — одна и та же группа
 */
export function okpdIn(code: string, prefix: string): boolean {
  const c = code.replace(/\.+$/, ""), p = prefix.replace(/\.+$/, "");
  if (c.startsWith(p)) return true;
  const strip = (x: string) => x.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return strip(c) === strip(p);
}

/** Индекс с самым длинным совпавшим префиксом ОКПД2, затем по разделу ОКВЭД2 */
export function findIndex(list: PriceIndex[], okpd2: string, section: string | null) {
  let best: PriceIndex | null = null;
  for (const ix of list) {
    if (!ix.key || !/^\d/.test(ix.key)) continue;
    if (okpdIn(okpd2, ix.key) && (!best || ix.key.length > best.key!.length)) best = ix;
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
    if (okpdIn(okpd2, r.prefix) && (!best || r.prefix.length > best.prefix.length)) best = r;
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
  const knownWs = new Set(ref.ws.map((w) => w.code));
  const newWs = new Set<string>();
  const points: ContractPoint[] = [];
  let matched = 0;

  const planK = (okpd2: string | null) => {
    const at = (kind: string) => ref.indices.filter((i) => isActiveIndex(i) && i.kind === kind && i.year === opt.targetYear);
    const cpi = at("cpi")[0]?.value ?? 1;
    const hit = okpd2 ? findIndex(at("forecast"), okpd2, okvedSection(okpd2, ref)) : null;
    return Math.max(hit?.index.value ?? cpi, cpi > 1 ? cpi : 1);
  };
  let laterYear = 0;
  const vatOther: Record<string, number> = {};
  const monthsBetween = (a: Date, b: Date) => (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() + (b.getUTCDate() >= a.getUTCDate() ? 1 : 0);
  for (const g of gpz) {
    const rep = (g.lot && byLot.get(g.lot)) || (g.procId && byProc.get(g.procId)) || null;
    // Закупка без договора: в расчёт цены не входит, но её НМЦ из ГПЗ с ростом цен попадает в сумму ГПЗ
    const plan = () => (g.nmcNoVat && g.nmcNoVat > 0 ? {
      nmc: g.nmcNoVat, okpd2: g.okpd2, category: g.category, region: g.region, subject: anonymize(g.subject ?? ""), k: planK(g.okpd2),
    } : undefined);
    const ex = (reason: string, withPlan = false) => excluded.push({ file: "ГПЗ", row: g.row, lot: g.lot ?? g.procId, reason, ...(withPlan ? { plan: plan() } : {}) });
    if (!rep) { ex("Нет в отчётности (договор не заключён)", true); continue; }
    matched++;
    const ws = g.ws ?? rep.ws;
    if (ws && !knownWs.has(ws)) newWs.add(ws);
    if (rep.status && NOT_CONCLUDED.test(rep.status)) { ex(`Договор не заключён: «${rep.status}»`, true); continue; }
    if (rep.priceNoVat == null || rep.priceNoVat <= 0) { ex("Нет фактической цены договора", true); continue; }
    if (!g.okpd2) { ex("Не указан ОКПД2"); continue; }
    if (g.regionError) { ex(g.regionError); continue; }
    let qty = rep.quantity ?? g.quantity;
    if (!qty || qty <= 0) { ex("Не указано количество"); continue; }
    if (!g.unit && !g.unitName) { ex("Не указана единица измерения"); continue; }
    const unit = unitLabel(g.unitName ?? g.unit, ref);
    const signed = rep.contractDate;
    const startD = g.workStart && signed && g.workStart > signed ? g.workStart : signed;
    const end = rep.endDate ?? g.workEnd;
    const months = startD && end && end > startD ? monthsBetween(startD, end) : null;
    // Месяцы договора в базовом году (и раньше) и после него: стоимость следующего года считается по новой цене
    const yearEnd = new Date(Date.UTC(opt.baseYear, 11, 31));
    const mAfter = months && end && end > yearEnd ? Math.min(months, monthsBetween(new Date(Date.UTC(opt.baseYear + 1, 0, 1)), end)) : 0;
    const mBase = months ? months - mAfter : null;
    // Единица «месяц»: количество — срок договора, а не 12 из ГПЗ (договор на 18 месяцев — делим на 18)
    const gpzQty = qty;
    if (/^мес/.test(unit) && months) qty = months;
    const at = signed;
    if (signed && signed.getUTCFullYear() > opt.baseYear) laterYear++;
    const fileVat = g.vatRate ?? rep.vatRate ?? null;
    const odd = fileVat != null && Math.abs(fileVat - DEFAULT_VAT) > 1e-9;
    if (odd) vatOther[String(Math.round(fileVat * 1000) / 10)] = (vatOther[String(Math.round(fileVat * 1000) / 10)] ?? 0) + 1;
    const gpzMonths = /^мес/.test(unit) ? gpzQty : null;
    points.push({
      okpd2: g.okpd2, unit, region: g.region, ws, category: g.category,
      method: g.method ?? null, subject: anonymize(g.subject ?? ""),
      raw: rep.priceNoVat / qty, month: at ? at.getUTCMonth() + 1 : null, year: at ? at.getUTCFullYear() : null, qty,
      vat: odd && !opt.trustVat ? DEFAULT_VAT : fileVat,
      vatFile: odd && !opt.trustVat ? fileVat : null,
      months,
      ds: rep.offerNoVat && rep.offerNoVat > 0 && rep.priceNoVat > rep.offerNoVat * 1.001 ? rep.priceNoVat / rep.offerNoVat - 1 : null,
      active: !!end && end.getUTCFullYear() > opt.targetYear || (!!end && end.getUTCFullYear() === opt.targetYear && end.getUTCMonth() === 11 && end.getUTCDate() === 31),
      gpzMonths: gpzMonths && months && Math.abs(gpzMonths - months) > 1 ? gpzMonths : null,
      quarter: g.quarter,
      currency: normCurrency(rep.currency),
      nmc: rep.nmcNoVat && rep.nmcNoVat > 0 ? rep.nmcNoVat / qty : null,
      planNmc: g.nmcNoVat && g.nmcNoVat > 0 && g.quantity ? g.nmcNoVat / g.quantity : null,
      lot: g.lot ?? g.procId, start: startD ? startD.toISOString().slice(0, 10) : null, end: end ? end.toISOString().slice(0, 10) : null,
      mBase, mAfter, regionFixed: !!g.regionNote,
    });
  }
  const rows = aggregateForecast(points, ref, opt);
  const gLots = new Set(gpz.map((g) => g.lot).filter(Boolean));
  const gProcs = new Set(gpz.map((g) => g.procId).filter(Boolean));
  for (const r of report) {
    if (!(r.lot && gLots.has(r.lot)) && !(r.procId && gProcs.has(r.procId))) excluded.push({ file: "Отчётность", row: r.row, lot: r.lot ?? r.procId, reason: "Нет в ГПЗ" });
  }
  return { rows, excluded, newWsCodes: [...newWs].sort(), stats: { gpz: gpz.length, matched, used: rows.reduce((s, r) => s + r.contracts, 0), laterYear, vatOther } };
}

/** Ключ группы позиций прогноза: ОКПД2 + единица + регион + код WS */
export const groupKey = (p: { okpd2: string; unit: string; region: string | null; ws: string | null; currency?: string | null }) =>
  [p.okpd2, p.unit, p.region ?? "", p.ws ?? ""].join("|") + (p.currency ? `|${p.currency}` : "");

/**
 * Группировка договоров и расчёт прогноза по индексам из справочника.
 * Используется и при первом расчёте, и при пересчёте сохранённого прогноза по новым индексам.
 */
export function aggregateForecast(points: ContractPoint[], ref: Reference, opt: ForecastOptions): ForecastRow[] {
  const sourceByCode = new Map(ref.sources.map((s) => [s.code, s]));
  const active = ref.indices.filter(isActiveIndex);
  const toDec = active.filter((i) => i.kind === "to_december" && i.year === opt.baseYear);
  const at = (kind: PriceIndex["kind"]) => active.filter((i) => i.kind === kind && i.year === opt.targetYear);
  const fc = at("forecast"), fcCons = at("forecast_cons");
  const cpi = at("cpi")[0] ?? null, cpiCons = at("cpi_cons")[0] ?? null;
  const wage = at("wage")[0] ?? null, wageCons = at("wage_cons")[0] ?? null;
  const fx = at("fx"), fxCons = at("fx_cons");
  const minstroy = at("minstroy");

  type Item = { p: ContractPoint; price: number; adjusted: boolean; needed: boolean; share: number };
  const groups = new Map<string, Item[]>();
  const lastMonth = toDec.length ? Math.min(12, Math.max(...toDec.map((i) => i.month ?? 0)) + 1) : 12;
  for (const p of points) {
    let price = p.raw;
    let adjusted = true;
    // Договор заходит на следующий год: месяцы после базового года оплачены уже по новой цене (× рост цен),
    // поэтому цена базового года = стоимость / (месяцы базового года + месяцы следующего × (1 + рост))
    let share = 1;
    if (p.mAfter && p.mAfter > 0 && p.mBase != null) {
      const kp = Math.max(findIndex(fc, p.okpd2, okvedSection(p.okpd2, ref))?.index.value ?? cpi?.value ?? 1, cpi?.value ?? 1);
      share = (p.mBase + p.mAfter) / (p.mBase + kp * p.mAfter);
      price *= share;
    }
    // Цена позже последнего месяца с данными Росстата (или в следующем году) уже на уровне точки пересчёта — шаг не нужен
    const year = p.year ?? opt.baseYear;
    const needed = year < opt.baseYear || (year === opt.baseYear && p.month !== 12 && (p.month == null || p.month < lastMonth));
    if (needed) {
      const cand = p.month && year === opt.baseYear ? toDec.filter((i) => i.month === p.month) : [];
      const hit = findIndex(cand, p.okpd2, okvedSection(p.okpd2, ref));
      if (hit) price *= hit.index.value;
      else adjusted = false;
    }
    const key = groupKey(p);
    const item = { p, price, adjusted, needed, share };
    groups.get(key)?.push(item) ?? groups.set(key, [item]);
  }

  const okpdName = (code: string) => {
    for (let c = code; c; c = c.includes(".") ? c.slice(0, c.lastIndexOf(".")) : c.length > 2 ? c.slice(0, 2) : "") {
      const hit = ref.okpd2.find((o) => o.code === c || (c.includes(".") && c.endsWith("0") && o.code === c.slice(0, -1)));
      if (hit) return hit.name;
    }
    return "";
  };
  const mostFrequent = (xs: (string | null)[]) => {
    const m = new Map<string, number>();
    for (const x of xs) if (x) m.set(x, (m.get(x) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };

  const rows: ForecastRow[] = [];
  for (const items of groups.values()) {
    const g0 = items[0].p;
    const okpd2 = g0.okpd2;
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
    const laterYear = items.filter((i) => (i.p.year ?? opt.baseYear) > opt.baseYear).length;
    if (laterYear) notes.push(`${laterYear} дог. заключены после ${opt.baseYear} года — пересчёт внутри года не применялся`);

    let needsApproval = false;
    let k = 1, level: ForecastRow["indexLevel"] = "cpi", src = "";
    let used: PriceIndex | null = null, cons: PriceIndex | null = null;
    const byKey = (list: PriceIndex[], key: string | null) => list.find((i) => i.key === key) ?? null;
    const fxHit = g0.currency ? byKey(fx, g0.currency) ?? byKey(fx, "USD") : null;
    const mHit = g0.region && CONSTRUCTION.some((c) => okpdIn(okpd2, c)) ? byKey(minstroy, g0.region) : null;
    const hit = findIndex(fc, okpd2, okvedSection(okpd2, ref));
    if (fxHit) {
      // Валютный договор: цена в рублях зависит от курса — рост по прогнозу курса МЭР
      level = "fx"; used = fxHit; cons = byKey(fxCons, fxHit.key);
      notes.push(`договор в валюте (${g0.currency}) — рост курса ${fxHit.key}${fxHit.key !== g0.currency ? " как ориентир" : ""}`);
    } else if (mHit) {
      level = "minstroy"; used = mHit;
      notes.push("строительство — индекс Минстроя по региону");
    } else if (wage && LABOR.some((c) => okpdIn(okpd2, c))) {
      // Охрана, клининг, питание, обучение: основная часть цены — зарплата персонала
      level = "wage"; used = wage; cons = wageCons;
      notes.push("трудоёмкая услуга — рост зарплат по прогнозу МЭР");
    } else if (hit) {
      used = hit.index; level = hit.level; cons = byKey(fcCons, hit.index.key);
      notes.push(level === "okpd2" ? `индекс по ОКПД2 ${hit.index.key}${okpdName(hit.index.key!) ? ` (${okpdName(hit.index.key!)})` : ""}` : `индекс по разделу ОКВЭД2 ${hit.index.key}`);
    } else {
      used = cpi; cons = cpiCons;
      needsApproval = true;
      notes.push(cpi ? "индекс по ОКПД2/ОКВЭД2 не найден — применён прогноз ИПЦ" : "нет ни отраслевого индекса, ни прогноза ИПЦ — цена не индексирована");
    }
    let floored: number | null = null;
    if (used) {
      k = used.value;
      // Отрицательный рост отрасли (снижение цен производителей) не значит, что закупка подешевеет:
      // в цену работ входят зарплаты и расходы исполнителя — берём не ниже общей инфляции
      if (k < 1 && cpi && cpi.value > 1 && level !== "fx") {
        floored = k;
        notes.push(`индекс ${pct(k)} отрицательный — для закупки взята инфляция ${pct(cpi.value)}`);
        k = cpi.value;
      }
      const s = used.source_code ? sourceByCode.get(used.source_code) : undefined;
      src = s?.name ?? used.source_code ?? "";
      if (!used.approved) { needsApproval = true; notes.push("индекс не утверждён"); }
    }
    if (needsApproval) flags.push("требует согласования");

    const repeatable = findRepeatable(ref, okpd2, g0.ws);
    if (repeatable === false) { flags.push("ориентир справочный"); notes.push("разовая закупка"); }
    if (repeatable === null) notes.push("повторяемость не определена");

    const name = okpdName(okpd2);
    const pts = items.map((i) => i.p);
    const volume = pts.reduce((s, p) => s + (p.qty ?? 0), 0);
    const baseSum = pts.reduce((s, p) => s + p.raw * (p.qty ?? 0), 0);
    const rawMed = median(keptItems.map((i) => i.p.raw));
    const vatFile = mostFrequent(pts.map((p) => (p.vatFile == null ? null : String(p.vatFile))));
    if (vatFile != null) notes.push(`в файле ставка НДС ${Math.round(Number(vatFile) * 1000) / 10} % — применена 22 %`);
    const names = new Map<string, number>();
    for (const p of pts) if (p.subject) names.set(p.subject, (names.get(p.subject) ?? 0) + 1);
    const quarters = [0, 0, 0, 0];
    for (const p of pts) if (p.quarter) quarters[p.quarter - 1]++;
    const lotPrice = LOT_UNITS.test(g0.unit) && pts.every((p) => p.qty === 1);
    rows.push({
      okpd2, okpd2Name: name,
      category: g0.category, ws: g0.ws,
      subject: name || items.map((i) => i.p.subject).find(Boolean) || okpd2,
      unit: g0.unit, unitLabel: g0.unit, region: g0.region,
      regionName: ref.regions.find((r) => r.code === g0.region)?.name ?? null,
      contracts: items.length, outliers,
      minPrice: round2(Math.min(...kept)), maxPrice: round2(Math.max(...kept)),
      basePrice: round2(base),
      forecastIndex: k, forecastIndexCons: floored != null ? Math.max(cons?.value ?? 0, cpiCons?.value ?? k) : cons?.value ?? k,
      indexFloored: floored,
      apportioned: items.filter((i) => i.share !== 1).length,
      regionFixed: items.filter((i) => i.p.regionFixed).length, indexLevel: level, indexSource: src, currency: g0.currency ?? null,
      indexSourceUrl: used?.source_code ? sourceByCode.get(used.source_code)?.url ?? "" : "",
      forecastPrice: round2(base * k),
      prices: keptItems.map((i) => round2(i.p.raw)).sort((a, b) => a - b),
      rawMedian: round2(median(keptItems.map((i) => i.p.raw))),
      outlierPrices,
      toDecember,
      indexKey: used?.key ?? null,
      indexApproved: used ? used.approved : null,
      indexSourceCode: used?.source_code ?? null,
      repeatable,
      method: mostFrequent(items.map((i) => i.p.method)),
      vatRate: ((v) => (v == null ? null : Number(v)))(mostFrequent(items.map((i) => (i.p.vat == null ? null : String(i.p.vat))))),
      points: items.map((i) => ({ ...i.p, raw: round2(i.p.raw), share: i.share === 1 ? null : Math.round(i.share * 100000) / 100000 })),
      vatFile: vatFile == null ? null : Number(vatFile),
      gpzNames: [...names.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 5),
      volume, baseSum: round2(baseSum),
      forecastSum: round2(rawMed > 0 ? baseSum * (base * k) / rawMed : baseSum * k),
      indexName: used && level === "okpd2" && used.key ? okpdName(used.key) || undefined : undefined,
      laterYear,
      longContracts: pts.filter((p) => (p.months ?? 0) > 12).length,
      dsUp: pts.filter((p) => p.ds != null).map((p) => Math.round(p.ds! * 1000) / 1000),
      activeTarget: pts.filter((p) => p.active).length,
      monthMismatch: pts.filter((p) => p.gpzMonths != null && p.months != null).map((p) => [p.gpzMonths!, p.months!] as [number, number]),
      lotPrice,
      quarters,
      ...((withNmc) => withNmc.length ? {
        nmcMedian: round2(median(withNmc.map((p) => p.nmc!))),
        nmcSum: round2(withNmc.reduce((s, p) => s + p.nmc! * (p.qty ?? 0), 0)),
        nmcContractSum: round2(withNmc.reduce((s, p) => s + p.raw * (p.qty ?? 0), 0)),
      } : {})(pts.filter((p) => p.nmc != null && p.nmc > 0)),
      needsApproval, smallSample, flags,
      comment: [`Медиана ${items.length - outliers} дог. ${round2(base)} ₽ → ${pct(k)}`, ...notes].join("; "),
    });
  }
  rows.sort((a, b) => a.okpd2.localeCompare(b.okpd2) || a.unit.localeCompare(b.unit));
  return rows;
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
    .replace(/(^|\s)(ООО|АО|ПАО|ЗАО|ОАО|ИП|ФГУП|МУП|ГУП)\s+[^\s,;]+/g, "$1")
    .replace(/ИНН\s*\d+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
