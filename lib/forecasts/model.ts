import type { ForecastRow } from "../forecast";
import type { PriceIndex, Reference } from "../types";

export type ForecastStatus = "draft" | "review" | "approved" | "archived";
export const STATUS_TITLE: Record<ForecastStatus, string> = { draft: "Черновик", review: "На проверке", approved: "Утверждён", archived: "В архиве" };

/** Цвета шапки карточки на выбор */
export const CARD_COLORS = ["violet", "teal", "emerald", "blue", "sky", "amber", "rose", "slate"] as const;
export type CardColor = (typeof CARD_COLORS)[number];

/** Разрешённые переходы статусов */
export const TRANSITIONS: Record<ForecastStatus, ForecastStatus[]> = {
  draft: ["review", "archived"],
  review: ["approved", "draft", "archived"],
  approved: ["archived"],
  archived: [],
};
export const canTransition = (from: ForecastStatus, to: ForecastStatus) => TRANSITIONS[from].includes(to);
/** Утверждённая и архивная версии не меняются — правка создаёт новую версию */
export const isFrozen = (s: ForecastStatus) => s === "approved" || s === "archived";

/** Агрегаты версии для плашек — считаются при сохранении, чтобы список не тянул строки */
export interface VersionStats {
  items: number;
  contracts: number;
  baseSum: number;
  forecastSum: number;
  /** Средний рост к базе, % */
  growth: number;
  needsReview: number;
  reviewed: number;
  edits: number;
  excluded: number;
}

export interface SnapshotIndex {
  id: number;
  kind: PriceIndex["kind"];
  key: string | null;
  year: number;
  month: number | null;
  value: number;
  approved: boolean;
  source: string | null;
  url: string | null;
  loadedAt: string | null;
}

/** Снимок индексов, по которым считается прогноз: отраслевые и ИПЦ на год прогноза, пересчёт внутри базового года */
export function indexSnapshot(ref: Reference, year: number, baseYear: number): SnapshotIndex[] {
  return ref.indices
    .filter((i) => !i.pending_of && !i.superseded_at)
    .filter((i) => ((i.kind === "forecast" || i.kind === "cpi") && i.year === year) || (i.kind === "to_december" && i.year === baseYear))
    .map((i) => {
      const s = ref.sources.find((x) => x.code === i.source_code);
      return {
        id: i.id, kind: i.kind, key: i.key, year: i.year, month: i.month, value: Number(i.value), approved: i.approved,
        source: s?.name ?? i.source_code ?? null, url: s?.url ?? null, loadedAt: i.loaded_at ?? null,
      };
    })
    .sort((a, b) => a.kind.localeCompare(b.kind) || (a.key ?? "").localeCompare(b.key ?? "") || (a.month ?? 0) - (b.month ?? 0));
}

/** Отпечаток набора индексов: меняется, если какой-то индекс добавлен, изменён или утверждён */
export const fingerprint = (snap: SnapshotIndex[]) => snap.map((i) => `${i.kind}:${i.key ?? ""}:${i.month ?? ""}:${i.value}:${i.approved ? 1 : 0}`).join("|");

/** Появились индексы, которых не было в снимке версии (новые, изменённые или утверждённые) */
export function hasNewIndices(current: SnapshotIndex[], snap: SnapshotIndex[]): boolean {
  const seen = new Set(fingerprint(snap).split("|"));
  return current.some((i) => !seen.has(fingerprint([i])));
}

/** Справочник с индексами из снимка — чтобы воспроизвести старую версию */
export function refFromSnapshot(ref: Reference, snap: SnapshotIndex[]): Reference {
  return {
    ...ref,
    indices: snap.map((i) => ({
      id: i.id, kind: i.kind, key: i.key, year: i.year, month: i.month, value: i.value, approved: i.approved,
      source_code: ref.sources.find((s) => s.name === i.source)?.code ?? null, note: null,
    })),
  };
}

/** Строка прогноза в хранилище */
export interface StoredItem {
  id: number;
  item_key: string;
  okpd2: string;
  subject: string;
  category: string | null;
  method: string | null;
  region: string | null;
  unit: string;
  contracts: number;
  base_price: number;
  index_value: number;
  index_source: string | null;
  forecast_price: number;
  needs_review: boolean;
  reviewed: boolean;
  manually_edited: boolean;
  data: ForecastRow;
}

/** Строка прогноза для показа: расчёт + ручные правки поверх */
export function itemToRow(i: StoredItem): ForecastRow {
  return { ...i.data, forecastPrice: Number(i.forecast_price), forecastIndex: Number(i.index_value), basePrice: Number(i.base_price) };
}

export function statsOf(items: { base_price: number; forecast_price: number; contracts: number; needs_review: boolean; reviewed: boolean; manually_edited: boolean }[], excluded = 0): VersionStats {
  const baseSum = items.reduce((s, i) => s + Number(i.base_price), 0);
  const forecastSum = items.reduce((s, i) => s + Number(i.forecast_price), 0);
  return {
    items: items.length,
    contracts: items.reduce((s, i) => s + Number(i.contracts), 0),
    baseSum: Math.round(baseSum * 100) / 100,
    forecastSum: Math.round(forecastSum * 100) / 100,
    growth: baseSum ? Math.round((forecastSum / baseSum - 1) * 1000) / 10 : 0,
    needsReview: items.filter((i) => i.needs_review).length,
    reviewed: items.filter((i) => i.needs_review && i.reviewed).length,
    edits: items.filter((i) => i.manually_edited).length,
    excluded,
  };
}

/** Средняя абсолютная ошибка в процентах по строкам, где есть факт */
export function mape(pairs: { forecast: number; actual: number }[]): number | null {
  const ok = pairs.filter((p) => p.actual > 0);
  if (!ok.length) return null;
  return Math.round((ok.reduce((s, p) => s + Math.abs(p.forecast - p.actual) / p.actual, 0) / ok.length) * 1000) / 10;
}

export const EVENT_TITLE: Record<string, string> = {
  upload: "Загрузка данных",
  calc: "Расчёт прогноза",
  edit: "Правка строки",
  review: "Проверка строки",
  version: "Новая версия",
  status: "Смена статуса",
  rename: "Переименование",
  recalc: "Пересчёт по новым индексам",
  actual: "Загрузка факта",
};

export const FIELD_TITLE: Record<string, string> = { forecast_price: "Прогноз", index_value: "Рост", reviewed: "Проверено", status: "Статус", title: "Название" };
