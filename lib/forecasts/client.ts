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

/** Договоры в строке — только цена и месяц: этого достаточно для пересчёта */
const slim = (r: ForecastRow) => ({ ...r, points: (r.points ?? []).map((p) => ({ raw: p.raw, month: p.month })) });

/** Чтение ГПЗ и отчётности в браузере и расчёт прогноза. Файлы на сервер не уходят */
export async function calcFromFiles(gpz: File, rep: File, reference: Reference, year: number, baseYear: number) {
  const g = parseGpz(await gpz.arrayBuffer(), reference.regions.map((r) => r.code));
  const r = parseReport(await rep.arrayBuffer());
  const result = buildForecast(g.rows, r.rows, reference, { baseYear, targetYear: year });
  if (!result.rows.length) throw new Error(`Ни одна строка не вошла в расчёт (не вошли: ${result.excluded.length}). Проверьте, что выбраны ГПЗ и отчётность одного года.`);
  try { localStorage.setItem(COVERAGE_KEY, JSON.stringify(buildCoverage(result.rows, year))); } catch { /* недоступно */ }
  if (result.newWsCodes.length) await api("/api/ws/auto", "POST", { codes: result.newWsCodes }).catch(() => null);
  return { result, gpzRows: g.rows.length };
}

/** Сохранение обезличенных строк в версию частями и подсчёт итогов */
export async function saveRows(forecastId: number, versionId: number, calc: Awaited<ReturnType<typeof calcFromFiles>>, onStep: (s: string) => void) {
  const rows = calc.result.rows;
  for (let i = 0; i < rows.length; i += CHUNK) {
    onStep(`Сохранение строк: ${Math.min(i + CHUNK, rows.length)} из ${rows.length}…`);
    await api(`/api/forecasts/${forecastId}/items`, "POST", { versionId, rows: rows.slice(i, i + CHUNK).map(slim) });
  }
  await api(`/api/forecasts/${forecastId}/finalize`, "POST", { versionId, gpzRows: calc.gpzRows, excluded: calc.result.excluded.length });
}
