"use client";
import { useState } from "react";
import { Modal } from "./Modal";
import { api } from "./useReference";
import { IconUpload } from "./Icons";
import { MONTHS, formatGrowth, industryName } from "@/lib/indexFormat";
import { MONTHS_GEN, parseRosstatIcp, toDecemberRows, type RosstatParse } from "@/lib/rosstat";
import type { Reference } from "@/lib/types";

const CHUNK = 500;

/** Загрузка файла Росстата «Индексы цен производителей по видам экономической деятельности» как есть */
export function RosstatImportButton({ reference, baseYear, onDone, disabled }: {
  reference: Reference; baseYear: number; onDone: (msg: string) => void; disabled?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<RosstatParse | null>(null);
  const [fileName, setFileName] = useState("");

  async function onFile(f: File) {
    setBusy("Чтение файла…"); setError(null); setFileName(f.name);
    try {
      // Файл большой — даём браузеру отрисовать «Чтение файла…» до разбора
      await new Promise((r) => setTimeout(r, 30));
      setParsed(parseRosstatIcp(await f.arrayBuffer(), baseYear));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  }

  async function save() {
    if (!parsed) return;
    const rows = toDecemberRows(parsed).map(({ key, year, month, value, note }) => ({ key, year, month, value, note }));
    setError(null);
    try {
      let inserted = 0, updated = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        setBusy(`Сохранение: ${Math.min(i + CHUNK, rows.length)} из ${rows.length}…`);
        const r = await api("/api/indices/rosstat", "POST", { rows: rows.slice(i, i + CHUNK) });
        inserted += r.inserted; updated += r.updated;
      }
      setParsed(null);
      onDone(`Индексы Росстата за ${parsed.year} год загружены: ${parsed.series.length} видов деятельности, добавлено ${inserted}, обновлено ${updated}. Все значения ждут проверки.`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  }

  const months = parsed ? Array.from({ length: Math.max(parsed.lastMonth - 1, 0) }, (_, i) => i + 1) : [];
  const total = parsed ? toDecemberRows(parsed).length : 0;
  const upTo = parsed ? MONTHS_GEN[parsed.lastMonth - 1] : "";

  return (
    <>
      <label className={`btn-sec cursor-pointer ${busy || disabled ? "pointer-events-none opacity-50" : ""}`}><IconUpload />{busy && !parsed ? busy : "Загрузить индексы Росстата"}
        <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
      </label>
      {error && !parsed && <span className="text-sm text-red-600">{error}</span>}
      {parsed && (
        <Modal wide title="Предпросмотр индексов Росстата" subtitle={`${fileName} · лист ${parsed.sheet} · ${parsed.year} год`} onClose={() => setParsed(null)}
          footer={<>
            <span className="mr-auto self-center text-sm text-slate-600">{parsed.series.length} видов деятельности · {total} коэффициентов по месяцам</span>
            <button className="btn-sec" onClick={() => setParsed(null)}>Отмена</button>
            <button className="btn" disabled={!!busy || !total} onClick={save}>{busy ?? "Сохранить на проверку"}</button>
          </>}>
          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">Не удалось сохранить: {error}</p>}
          {parsed.warnings.map((w) => <p key={w} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">{w}</p>)}
          <p className="hint">
            Для каждого вида деятельности и месяца заключения договора — на сколько выросли цены производителей до {upTo}. Так цена договора, заключённого в начале года, доводится до уровня конца года. Значения по Российской Федерации.
          </p>
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200">
            <table className="tbl">
              <thead><tr><th>Вид деятельности</th>{months.map((m) => <th key={m} className="text-right">{MONTHS[m - 1].slice(0, 3)}</th>)}</tr></thead>
              <tbody>
                {parsed.series.map((s) => {
                  const last = s.values[parsed.lastMonth - 1];
                  return (
                    <tr key={s.key}>
                      <td className="min-w-[16rem]"><span className="font-medium">{s.key}</span> <span className="text-slate-600">{industryName(s.key, reference) ?? s.name}</span></td>
                      {months.map((m) => {
                        const v = s.values[m - 1];
                        return <td key={m} className="whitespace-nowrap text-right text-xs">{v && last ? formatGrowth(last / v) : "—"}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </>
  );
}
