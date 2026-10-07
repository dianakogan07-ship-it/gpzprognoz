import { formatGrowth } from "../indexFormat";
import { isActiveIndex, type PriceIndex } from "../types";

/** Значение из прогноза МЭР, готовое к сохранению (один код — одна запись) */
export interface MerIncoming {
  kind: "forecast" | "cpi";
  key: string | null;
  year: number;
  value: number;
  indicator: "icp" | "deflator" | null;
  ref_deflator: number | null;
  raw_line: string;
  doc_page: string;
}
export interface MerDoc { title: string; date: string | null }

export type MerAction =
  | { type: "insert"; row: MerIncoming }
  | { type: "update"; id: number; row: MerIncoming; change: string | null }
  | { type: "version"; of: number; pendingId: number | null; row: MerIncoming; change: string }
  | { type: "same"; id: number; row: MerIncoming };

const sameKey = (i: PriceIndex, r: MerIncoming) => i.kind === r.kind && (i.key ?? null) === (r.key ?? null) && i.year === r.year && i.month == null;

/**
 * Что сделать с каждым значением нового прогноза:
 * — индекса нет → добавить со статусом «Нужна проверка»;
 * — есть неутверждённый → обновить на месте;
 * — есть утверждённый с тем же значением → ничего не менять;
 * — есть утверждённый с другим значением → новая версия, ожидающая проверки; утверждённый остаётся в силе.
 */
export function planMerCommit(existing: PriceIndex[], incoming: MerIncoming[]): MerAction[] {
  return incoming.map((row) => {
    const active = existing.find((i) => isActiveIndex(i) && sameKey(i, row));
    if (!active) return { type: "insert", row };
    const same = Math.abs(active.value - row.value) < 0.000005;
    if (!active.approved) {
      return { type: "update", id: active.id, row, change: same ? null : `Было ${formatGrowth(active.value)}, обновлено из нового прогноза: ${formatGrowth(row.value)}` };
    }
    if (same) return { type: "same", id: active.id, row };
    const pending = existing.find((i) => i.pending_of === active.id);
    return {
      type: "version", of: active.id, pendingId: pending?.id ?? null, row,
      change: `Утверждено ${formatGrowth(active.value)}, в новом прогнозе ${formatGrowth(row.value)}`,
    };
  });
}

export function summarize(actions: MerAction[]) {
  return {
    inserted: actions.filter((a) => a.type === "insert").length,
    updated: actions.filter((a) => a.type === "update").length,
    versions: actions.filter((a) => a.type === "version").length,
    unchanged: actions.filter((a) => a.type === "same").length,
  };
}
