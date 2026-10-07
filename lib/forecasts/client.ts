"use client";
import { api } from "@/components/useReference";
import { downloadWorkbook, forecastWorkbook } from "../excel";
import type { ForecastRow } from "../forecast";
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
