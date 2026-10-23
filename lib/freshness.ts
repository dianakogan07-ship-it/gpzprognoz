import { MONTHS } from "./indexFormat";
import { isActiveIndex, type PriceIndex } from "./types";

/** Источник данных и как часто он обновляется */
export type FreshId = "mer" | "cbr" | "rosstat" | "minstroy";
export interface Stale {
  id: FreshId;
  title: string;
  /** Почему пора обновить — простыми словами */
  reason: string;
  /** Последняя загрузка, ISO; не загружали — null */
  last: string | null;
}

export const FRESH_RULE: Record<FreshId, string> = {
  mer: "Минэкономразвития публикует прогноз раз в год, в сентябре",
  cbr: "Обновляйте раз в год, в октябре: файл «Агрегированные результаты опроса» Банка России",
  rosstat: "Росстат публикует цены производителей ежемесячно, примерно через 3–4 недели после конца месяца",
  minstroy: "Минстрой публикует индексы раз в квартал",
};

const DAY = 864e5;
const lastOf = (xs: PriceIndex[]) => {
  const ts = xs.map((i) => (i.loaded_at ? Date.parse(i.loaded_at) : NaN)).filter(Number.isFinite);
  return ts.length ? new Date(Math.max(...ts)).toISOString() : null;
};
const fmt = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

/**
 * Какие данные для прогноза на year (база — baseYear) устарели на дату now.
 * МЭР — новый прогноз выходит в сентябре; ЦБ — раз в месяц; Росстат — ждём данные за позапрошлый месяц; Минстрой — раз в квартал.
 */
export function staleness(indices: PriceIndex[], year: number, baseYear: number, now = new Date()): Stale[] {
  const act = indices.filter(isActiveIndex);
  const out: Stale[] = [];
  // МЭР: прогноз на год прогноза должен быть из последней сентябрьской публикации
  const mer = act.filter((i) => i.year === year && /^(forecast|cpi|wage|fx)/.test(i.kind) && (i.source_code === "MER_FORECAST" || i.source_code === "MER_MACRO"));
  const merLast = lastOf(mer);
  const sept = new Date(Date.UTC(now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1, 8, 1));
  if (!mer.length) out.push({ id: "mer", title: "Прогноз Минэкономразвития", reason: `нет прогноза на ${year} год`, last: null });
  else if (merLast && Date.parse(merLast) < sept.getTime() && now.getTime() - sept.getTime() > 30 * DAY)
    out.push({ id: "mer", title: "Прогноз Минэкономразвития", reason: `загружен ${fmt(merLast)}, а в сентябре ${sept.getUTCFullYear()} вышел новый`, last: merLast });
  // ЦБ: прогноз инфляции сверяется раз в месяц
  const cpi = act.filter((i) => i.kind === "cpi" && i.year === year);
  const cpiLast = lastOf(cpi);
  if (!cpi.length) out.push({ id: "cbr", title: "Прогноз инфляции", reason: `нет прогноза инфляции на ${year} год`, last: null });
  else {
    // Раз в год: после октябрьского опроса года перед прогнозным данные должны быть загружены позже 1 октября
    const oct = Date.UTC(year - 1, 9, 1), nov = Date.UTC(year - 1, 10, 1);
    if (now.getTime() >= nov && (!cpiLast || Date.parse(cpiLast) < oct))
      out.push({ id: "cbr", title: "Прогноз инфляции", reason: `вышел октябрьский опрос Банка России ${year - 1} года${cpiLast ? `, а загружено ${fmt(cpiLast)}` : ""}`, last: cpiLast });
  }
  // Росстат: данные за базовый год — до позапрошлого месяца (или весь год, если он закончился)
  if (baseYear <= now.getUTCFullYear()) {
    const ros = act.filter((i) => i.kind === "to_december" && i.year === baseYear);
    const have = ros.length ? Math.max(...ros.map((i) => i.month ?? 0)) + 1 : 0; // последний месяц с данными
    const ago = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
    const expect = ago.getUTCFullYear() > baseYear ? 12 : ago.getUTCFullYear() < baseYear ? 0 : ago.getUTCMonth() + 1;
    if (expect > 0 && have < expect)
      out.push({ id: "rosstat", title: "Индексы Росстата", reason: have ? `последние данные — за ${MONTHS[have - 1]} ${baseYear}, уже опубликован ${MONTHS[expect - 1]}` : `нет данных за ${baseYear} год`, last: lastOf(ros) });
  }
  // Минстрой: если индексы по регионам используются — обновлять каждый квартал
  const ms = act.filter((i) => i.kind === "minstroy" && i.year === year);
  const msLast = lastOf(ms);
  if (ms.length && msLast && now.getTime() - Date.parse(msLast) > 100 * DAY)
    out.push({ id: "minstroy", title: "Индексы Минстроя по регионам", reason: `загружены ${fmt(msLast)} — вышел новый квартал`, last: msLast });
  return out;
}
