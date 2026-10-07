import type { ExcludedRow, ForecastRow } from "./forecast";
import type { Source } from "./types";

/* ---------- Статус позиции ---------- */

export type Status = "reliable" | "check" | "lowdata";
export const STATUS_LABEL: Record<Status, string> = { reliable: "Надёжно", check: "Проверить", lowdata: "Мало данных" };

export type ReasonCode = "cpi" | "no_index" | "unapproved" | "not_december" | "repeat_unknown" | "few_contracts";
export const REASON_TEXT: Record<ReasonCode, string> = {
  cpi: "Отраслевой индекс не найден — применена общая инфляция",
  no_index: "Нет ни отраслевого индекса, ни общей инфляции — цена не пересчитана на следующий год",
  unapproved: "Применённый индекс ещё не утверждён",
  not_december: "Цена не доведена до уровня декабря — нет индекса пересчёта за месяц договора",
  repeat_unknown: "Не определено, повторяющаяся ли это закупка",
  few_contracts: "Меньше трёх договоров — цена может быть случайной",
};

export function reasonsOf(r: ForecastRow): ReasonCode[] {
  const out: ReasonCode[] = [];
  if (r.indexLevel === "cpi") out.push(r.indexApproved === null ? "no_index" : "cpi");
  if (r.indexApproved === false) out.push("unapproved");
  if (r.toDecember === "none" || r.toDecember === "partial") out.push("not_december");
  if (r.repeatable === null) out.push("repeat_unknown");
  if (r.contracts < 3) out.push("few_contracts");
  return out;
}

/**
 * «Мало данных» — 1–2 договора (остальные причины видны в подсказке);
 * «Проверить» — есть хотя бы одна причина; иначе «Надёжно»
 * (отраслевой утверждённый индекс, не менее трёх договоров).
 */
export function statusOf(r: ForecastRow): Status {
  if (r.contracts < 3) return "lowdata";
  return reasonsOf(r).length ? "check" : "reliable";
}

/* ---------- Подготовленные строки ---------- */

export interface ViewRow {
  /** Номер позиции в результате расчёта — устойчивый ключ строки */
  id: number;
  row: ForecastRow;
  status: Status;
  reasons: ReasonCode[];
  /** Рост в процентах, 4.0 = +4 % */
  growth: number;
  search: string;
  /** Для сохранённого прогноза: строка в хранилище и отметки проверки */
  meta?: RowMeta;
}

export interface RowMeta { itemId: number; needsReview: boolean; reviewed: boolean; edited: boolean }

export function toViewRows(rows: ForecastRow[], metas?: RowMeta[]): ViewRow[] {
  return rows.map((row, id) => ({
    id: metas?.[id]?.itemId ?? id,
    row,
    meta: metas?.[id],
    status: statusOf(row),
    reasons: reasonsOf(row),
    growth: Math.round((row.forecastIndex - 1) * 1000) / 10,
    search: `${row.subject} ${row.okpd2} ${row.okpd2Name}`.toLowerCase(),
  }));
}

/* ---------- Фильтры ---------- */

export type SourceKind = "okpd2" | "okved2" | "cpi";
export type ContractsBucket = "1" | "2-4" | "5+";
export type Repeat = "yes" | "no" | "unknown";
export type Flag = "review" | "edited";
export const FLAG_LABEL: Record<Flag, string> = { review: "Согласовать человеком", edited: "Есть ручные правки" };
export type SortKey = "subject" | "region" | "price" | "growth" | "forecast";

export interface Filters {
  q: string;
  status: Status[];
  category: string[];
  region: string[];
  okpd: string;
  source: SourceKind[];
  contracts: ContractsBucket[];
  growthMin: number | null;
  growthMax: number | null;
  repeat: Repeat[];
  method: string[];
  /** «review» — требует согласования, «edited» — есть ручные правки */
  flags: Flag[];
  sort: SortKey | null;
  dir: "asc" | "desc";
  /** Фильтры списка «Не вошли в расчёт» */
  exFile: string[];
  exReason: string[];
}

export const EMPTY_FILTERS: Filters = {
  q: "", status: [], category: [], region: [], okpd: "", source: [], contracts: [],
  growthMin: null, growthMax: null, repeat: [], method: [], flags: [], sort: null, dir: "asc", exFile: [], exReason: [],
};

export const SOURCE_LABEL: Record<SourceKind, string> = { okpd2: "Отраслевой ОКПД2", okved2: "Отраслевой ОКВЭД2", cpi: "Общая инфляция" };
export const CONTRACTS_LABEL: Record<ContractsBucket, string> = { "1": "1", "2-4": "2–4", "5+": "5 и более" };
export const REPEAT_LABEL: Record<Repeat, string> = { yes: "Повторяющиеся", no: "Разовые", unknown: "Не определена" };

const bucketOf = (n: number): ContractsBucket => (n <= 1 ? "1" : n <= 4 ? "2-4" : "5+");
const repeatOf = (r: boolean | null): Repeat => (r === null ? "unknown" : r ? "yes" : "no");
/** Ключ региона для фильтра: код ОКАТО, а если его нет — «нет» */
export const regionKey = (r: ForecastRow) => r.region ?? "";

/** Совпадение кода ОКПД2 с префиксом: «28» → 28, 28.1, 28.99.39; «09.10» → 09.10, 09.10.11 */
export function matchesOkpd(code: string, prefix: string): boolean {
  const p = prefix.trim().replace(/,/g, ".").replace(/\.+$/, "");
  if (!p) return true;
  return code === p || code.startsWith(p + ".") || (/^\d$/.test(p) && code.startsWith(p));
}

export function filterRows(rows: ViewRow[], f: Filters): ViewRow[] {
  const q = f.q.trim().toLowerCase();
  const words = q ? q.split(/\s+/) : [];
  const st = new Set(f.status), cat = new Set(f.category), reg = new Set(f.region), src = new Set(f.source),
    cnt = new Set(f.contracts), rep = new Set(f.repeat), mth = new Set(f.method), fl = new Set(f.flags);
  return rows.filter((v) => {
    const r = v.row;
    if (words.length && !words.every((w) => v.search.includes(w))) return false;
    if (st.size && !st.has(v.status)) return false;
    if (cat.size && !cat.has(r.category ?? "")) return false;
    if (reg.size && !reg.has(regionKey(r))) return false;
    if (f.okpd && !matchesOkpd(r.okpd2, f.okpd)) return false;
    if (src.size && !src.has(r.indexLevel)) return false;
    if (cnt.size && !cnt.has(bucketOf(r.contracts))) return false;
    if (f.growthMin != null && v.growth < f.growthMin) return false;
    if (f.growthMax != null && v.growth > f.growthMax) return false;
    if (rep.size && !rep.has(repeatOf(r.repeatable))) return false;
    if (mth.size && !mth.has(r.method ?? "")) return false;
    if (fl.has("review") && !(v.meta ? v.meta.needsReview : r.needsApproval)) return false;
    if (fl.has("edited") && !v.meta?.edited) return false;
    return true;
  });
}

export function sortRows(rows: ViewRow[], key: SortKey | null, dir: "asc" | "desc"): ViewRow[] {
  if (!key) return rows;
  const get: Record<SortKey, (v: ViewRow) => string | number> = {
    subject: (v) => v.row.subject.toLowerCase(),
    region: (v) => (v.row.regionName ?? v.row.region ?? "").toLowerCase(),
    price: (v) => v.row.basePrice,
    growth: (v) => v.growth,
    forecast: (v) => v.row.forecastPrice,
  };
  const g = get[key];
  const k = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = g(a), y = g(b);
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ru", { numeric: true })) * k;
  });
}

/* ---------- Фильтры в адресной строке ---------- */

const LIST_KEYS = { status: "st", category: "cat", region: "reg", source: "src", contracts: "n", repeat: "rep", method: "m", flags: "fl", exFile: "xf", exReason: "xr" } as const;

export function filtersToQuery(f: Filters): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  for (const [k, short] of Object.entries(LIST_KEYS)) {
    const v = f[k as keyof typeof LIST_KEYS] as string[];
    if (v.length) p.set(short, v.join("~"));
  }
  if (f.okpd.trim()) p.set("okpd", f.okpd.trim());
  if (f.growthMin != null) p.set("gmin", String(f.growthMin));
  if (f.growthMax != null) p.set("gmax", String(f.growthMax));
  if (f.sort) p.set("sort", `${f.sort}:${f.dir}`);
  return p.toString();
}

export function filtersFromQuery(qs: string | URLSearchParams): Filters {
  const p = typeof qs === "string" ? new URLSearchParams(qs) : qs;
  const list = <T extends string>(k: string, allowed?: readonly T[]) => {
    const v = (p.get(k) ?? "").split("~").filter(Boolean) as T[];
    return allowed ? v.filter((x) => allowed.includes(x)) : v;
  };
  const num = (k: string) => { const v = p.get(k); if (v == null || v === "") return null; const n = Number(v.replace(",", ".")); return Number.isFinite(n) ? n : null; };
  const [sort, dir] = (p.get("sort") ?? "").split(":");
  const sorts: SortKey[] = ["subject", "region", "price", "growth", "forecast"];
  return {
    q: p.get("q") ?? "",
    status: list<Status>("st", ["reliable", "check", "lowdata"]),
    category: list("cat"),
    region: list("reg"),
    okpd: p.get("okpd") ?? "",
    source: list<SourceKind>("src", ["okpd2", "okved2", "cpi"]),
    contracts: list<ContractsBucket>("n", ["1", "2-4", "5+"]),
    growthMin: num("gmin"),
    growthMax: num("gmax"),
    repeat: list<Repeat>("rep", ["yes", "no", "unknown"]),
    method: list("m"),
    flags: list<Flag>("fl", ["review", "edited"]),
    sort: sorts.includes(sort as SortKey) ? (sort as SortKey) : null,
    dir: sorts.includes(sort as SortKey) && dir === "desc" ? "desc" : "asc",
    exFile: list("xf"),
    exReason: list("xr"),
  };
}

/* ---------- Подсказка к действию ---------- */

export interface ActionHint { reason: ReasonCode; count: number; text: string; href: string; action: string }

/** Если одна причина «Проверить» у ≥ 80 % позиций — одна общая подсказка вместо повторения в строках */
export function actionHint(rows: ViewRow[], threshold = 0.8): ActionHint | null {
  if (!rows.length) return null;
  const counts = new Map<ReasonCode, number>();
  for (const v of rows) for (const r of v.reasons) if (r !== "few_contracts") counts.set(r, (counts.get(r) ?? 0) + 1);
  let best: [ReasonCode, number] | null = null;
  for (const e of counts) if (!best || e[1] > best[1]) best = e;
  if (!best || best[1] / rows.length < threshold) return null;
  const [reason, n] = best;
  const pos = `${n} ${plural(n, "позиции", "позиций", "позиций")}`;
  const map: Record<Exclude<ReasonCode, "few_contracts">, Omit<ActionHint, "reason" | "count">> = {
    cpi: { text: `Для ${pos} применена общая инфляция — добавьте отраслевые индексы, чтобы прогноз стал точнее`, href: "/indices", action: "Перейти к индексам" },
    no_index: { text: `Для ${pos} нет ни отраслевого индекса, ни общей инфляции — добавьте индексы роста цен`, href: "/indices", action: "Перейти к индексам" },
    unapproved: { text: `Для ${pos} применён неутверждённый индекс — проверьте и утвердите индексы`, href: "/indices", action: "Перейти к индексам" },
    not_december: { text: `Для ${pos} цена не доведена до уровня декабря — добавьте индексы пересчёта внутри года`, href: "/indices", action: "Перейти к индексам" },
    repeat_unknown: { text: `Для ${pos} не определено, повторяющаяся ли закупка — дополните справочник повторяемости`, href: "/directories", action: "Перейти к справочникам" },
  };
  return { reason, count: n, ...map[reason as Exclude<ReasonCode, "few_contracts">] };
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/* ---------- Исключённые строки ---------- */

/** Причина без подробностей: «Договор не заключён: «Не размещена»» → «Договор не заключён» */
export const reasonGroup = (reason: string) => reason.split(":")[0].replace(/\s*\(.*\)$/, "").trim();

export function filterExcluded(rows: ExcludedRow[], f: Pick<Filters, "exFile" | "exReason">): ExcludedRow[] {
  const files = new Set(f.exFile), reasons = new Set(f.exReason);
  return rows.filter((e) => (!files.size || files.has(e.file)) && (!reasons.size || reasons.has(reasonGroup(e.reason))));
}

/* ---------- Источник ---------- */

const SHORT_SOURCE: Record<string, string> = {
  ROSSTAT_ICP: "Росстат, ИЦП", ROSSTAT_CPI: "Росстат, ИПЦ", EMISS: "ЕМИСС", MER_FORECAST: "МЭР",
  CBR: "Банк России", MINSTROY: "Минстрой России", NK_RF: "НК РФ",
};

/** Короткое название источника: «МЭР» вместо полного заголовка документа */
export function shortSource(code: string | null, sources: Source[]): { name: string; url: string } | null {
  if (!code) return null;
  const s = sources.find((x) => x.code === code);
  return { name: SHORT_SOURCE[code] ?? s?.name.split(" — ")[0] ?? code, url: s?.url ?? "" };
}

export const fmtRub = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
export const fmtGrowth = (g: number) => `${g < 0 ? "−" : "+"}${Math.abs(g).toFixed(1).replace(".", ",")} %`;
