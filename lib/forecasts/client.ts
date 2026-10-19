"use client";
import { api } from "@/components/useReference";
import { downloadWorkbook, forecastWorkbook } from "../excel";
import { buildForecast, type ForecastRow } from "../forecast";
import { parseGpz, parseReport } from "../parse";
import { COVERAGE_KEY, buildCoverage } from "../indexFormat";
import type { Reference } from "../types";
import type { RowMeta } from "../forecastView";
import type { Source } from "../types";
import { itemToRow, type StoredItem } from "./model";

export async function loadVersionRows(forecastId: number, versionId: number) {
  const items = (await api(`/api/forecasts/${forecastId}/items?version=${versionId}`, "GET")) as StoredItem[];
  const rows: ForecastRow[] = items.map(itemToRow);
  const metas: RowMeta[] = items.map((i) => ({ itemId: i.id, needsReview: i.needs_review, reviewed: i.reviewed, edited: i.manually_edited }));
  return { items, rows, metas };
}

export function exportRows(title: string, year: number, version: number, rows: ForecastRow[], sources: Source[], suffix = "") {
  const res = { rows, excluded: [], newWsCodes: [], stats: { gpz: 0, matched: 0, used: rows.reduce((s, r) => s + r.contracts, 0) } };
  const name = `${title} v${version}${suffix}`.replace(/[\\/:*?"<>|]+/g, " ").trim();
  downloadWorkbook(forecastWorkbook(res, sources, year, rows), `${name}.xlsx`);
}

export async function exportVersion(f: { id: number; title: string; year: number }, versionId: number, version: number, sources: Source[]) {
  const { rows } = await loadVersionRows(f.id, versionId);
  exportRows(f.title, f.year, version, rows, sources);
}

export const fmtDate = (s: string) => new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
export const fmtDateTime = (s: string) => new Date(s).toLocaleString("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const CHUNK = 300;

/** Договоры в строке — только цена, дата, количество и отметки: этого достаточно для пересчёта, без сведений о заказчике */
const slim = (r: ForecastRow) => ({ ...r, points: (r.points ?? []).map(({ raw, month, year, qty, months, ds, active, gpzMonths, quarter, vatFile, currency, nmc }) => ({ raw, month, year, qty, months, ds, active, gpzMonths, quarter, vatFile, currency, nmc })) });

/** Отпечаток пары файлов: по нему узнаём повторную загрузку тех же файлов. Сами файлы на сервер не уходят */
async function filesHash(a: ArrayBuffer, b: ArrayBuffer) {
  const hex = async (x: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", x))].map((n) => n.toString(16).padStart(2, "0")).join("");
  return hex(new TextEncoder().encode(`${await hex(a)}:${await hex(b)}`).buffer as ArrayBuffer);
}

/** Чтение ГПЗ и отчётности в браузере и расчёт прогноза. Файлы на сервер не уходят */
export async function calcFromFiles(gpz: File, rep: File, reference: Reference, year: number, baseYear: number, opts: { trustVat?: boolean } = {}) {
  const gb = await gpz.arrayBuffer(), rb = await rep.arrayBuffer();
  const g = parseGpz(gb, reference.regions);
  const r = parseReport(rb);
  const result = buildForecast(g.rows, r.rows, reference, { baseYear, targetYear: year, trustVat: opts.trustVat });
  if (!result.rows.length) throw new Error(`Ни одна строка не вошла в расчёт (не вошли: ${result.excluded.length}). Проверьте, что выбраны ГПЗ и отчётность одного года.`);
  try { localStorage.setItem(COVERAGE_KEY, JSON.stringify(buildCoverage(result.rows, year))); } catch { /* недоступно */ }
  if (result.newWsCodes.length) await api("/api/ws/auto", "POST", { codes: result.newWsCodes }).catch(() => null);
  return { result, gpzRows: g.rows.length, hash: await filesHash(gb, rb), baseYear };
}

export interface Dupe { forecast_id: number; title: string; number: number; created_at: string }
/** Что показать пользователю перед сохранением: те же файлы уже загружены, договоры следующего года, ставки НДС не 22 % */
export async function uploadIssues(calc: Awaited<ReturnType<typeof calcFromFiles>>) {
  const dupes = ((await api(`/api/forecasts/dupes?hash=${calc.hash}`, "GET").catch(() => [])) ?? []) as Dupe[];
  const { laterYear = 0, vatOther = {} } = calc.result.stats;
  const any = dupes.length > 0 || laterYear > 0 || Object.keys(vatOther).length > 0;
  return { dupes, laterYear, vatOther, baseYear: calc.baseYear, any };
}
export type UploadIssues = Awaited<ReturnType<typeof uploadIssues>>;

/** Сохранение обезличенных строк в версию частями и подсчёт итогов */
export async function saveRows(forecastId: number, versionId: number, calc: Awaited<ReturnType<typeof calcFromFiles>>, onStep: (s: string) => void) {
  const rows = calc.result.rows;
  for (let i = 0; i < rows.length; i += CHUNK) {
    onStep(`Сохранение строк: ${Math.min(i + CHUNK, rows.length)} из ${rows.length}…`);
    await api(`/api/forecasts/${forecastId}/items`, "POST", { versionId, rows: rows.slice(i, i + CHUNK).map(slim) });
  }
  await api(`/api/forecasts/${forecastId}/finalize`, "POST", { versionId, gpzRows: calc.gpzRows, excluded: calc.result.excluded.length, excludedRows: calc.result.excluded, hash: calc.hash });
}
