"use client";
import { useState } from "react";
import { Modal } from "./Modal";
import { api } from "./useReference";
import { IconUpload } from "./Icons";
import { MONTHS, formatGrowth, industryName } from "@/lib/indexFormat";
import { MONTHS_GEN, ROSSTAT_KIND_TITLE, parseRosstatIcp, toDecemberRows, type RosstatParse } from "@/lib/rosstat";
import type { Reference } from "@/lib/types";

const CHUNK = 500;
type Parsed = RosstatParse & { file: string };

/**
 * Загрузка файлов Росстата раздела «Цены производителей» как есть — можно выбрать несколько сразу:
 * промышленные товары, строительная продукция, грузовые перевозки, услуги связи.
 */
export function RosstatImportButton({ reference, baseYear, onDone, disabled }: {
  reference: Reference; baseYear: number; onDone: (msg: string) => void; disabled?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed[] | null>(null);
  const [failed, setFailed] = useState<{ file: string; error: string }[]>([]);

  async function onFiles(files: File[]) {
    setError(null);
    const ok: Parsed[] = [], bad: { file: string; error: string }[] = [];
    for (const f of files) {
      setBusy(`Чтение: ${f.name}…`);
      // Файлы большие — даём браузеру отрисовать подпись до разбора
      await new Promise((r) => setTimeout(r, 30));
      try { ok.push({ ...parseRosstatIcp(await f.arrayBuffer(), baseYear), file: f.name }); }
      catch (e) { bad.push({ file: f.name, error: e instanceof Error ? e.message : String(e) }); }
    }
    setBusy(null);
    setFailed(bad);
    if (ok.length) setParsed(ok);
    else setError(bad.map((b) => `${b.file}: ${b.error}`).join(" "));
  }

  async function save() {
    if (!parsed) return;
    const rows = parsed.flatMap((p) => toDecemberRows(p)).map(({ key, year, month, value, note }) => ({ key, year, month, value, note }));
    setError(null);
    try {
      let inserted = 0, updated = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        setBusy(`Сохранение: ${Math.min(i + CHUNK, rows.length)} из ${rows.length}…`);
        const r = await api("/api/indices/rosstat", "POST", { rows: rows.slice(i, i + CHUNK) });
        inserted += r.inserted; updated += r.updated;
      }
      const what = parsed.map((p) => ROSSTAT_KIND_TITLE[p.kind].toLowerCase()).join(", ");
      setParsed(null);
      onDone(`Индексы Росстата загружены (${what}): добавлено ${inserted}, обновлено ${updated}. Все значения ждут проверки.`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  }

  const total = parsed ? parsed.reduce((n, p) => n + toDecemberRows(p).length, 0) : 0;

  return (
    <>
      <label className={`btn-sec cursor-pointer ${busy || disabled ? "pointer-events-none opacity-50" : ""}`}><IconUpload />{busy && !parsed ? busy : "Загрузить индексы Росстата"}
        <input type="file" multiple accept=".xlsx,.xls" className="hidden" onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; if (fs.length) onFiles(fs); }} />
      </label>
      {error && !parsed && <span className="text-sm text-red-600">{error}</span>}
      {parsed && (
        <Modal wide title="Предпросмотр индексов Росстата" subtitle={`Пересчёт цен договоров внутри ${parsed[0].year} года`} onClose={() => setParsed(null)}
          footer={<>
            <span className="mr-auto self-center text-sm text-slate-600">{parsed.length} {parsed.length === 1 ? "файл" : "файла"} · {total} коэффициентов по месяцам</span>
            <button className="btn-sec" onClick={() => setParsed(null)}>Отмена</button>
            <button className="btn" disabled={!!busy || !total} onClick={save}>{busy ?? "Сохранить на проверку"}</button>
          </>}>
          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">Не удалось сохранить: {error}</p>}
          {failed.map((f) => <p key={f.file} className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">Не загружен {f.file}: {f.error}</p>)}
          {parsed.flatMap((p) => p.warnings).map((w) => <p key={w} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">{w}</p>)}
          <p className="hint">Для каждого вида деятельности и месяца заключения договора — на сколько выросли цены до последнего месяца с данными. Так цена договора, заключённого в начале года, доводится до уровня конца года. Значения по Российской Федерации.</p>
          <div className="max-h-[50vh] space-y-4 overflow-auto">
            {parsed.map((p) => {
              const months = Array.from({ length: Math.max(p.lastMonth - 1, 0) }, (_, i) => i + 1);
              return (
                <div key={p.file} className="rounded-lg border border-slate-200">
                  <p className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-900">
                    {ROSSTAT_KIND_TITLE[p.kind]} <span className="font-normal text-slate-500">· {p.file} · лист {p.sheet} · до {MONTHS_GEN[p.lastMonth - 1]} {p.year}</span>
                  </p>
                  <table className="tbl">
                    <thead><tr><th>Вид деятельности</th>{months.map((m) => <th key={m} className="text-right">{MONTHS[m - 1].slice(0, 3)}</th>)}</tr></thead>
                    <tbody>
                      {p.series.map((s) => {
                        const last = s.values[p.lastMonth - 1];
                        return (
                          <tr key={s.key}>
                            <td className="min-w-[16rem]"><span className="font-medium">{s.key}</span> <span className="text-slate-600">{p.kind === "industry" ? industryName(s.key, reference) ?? s.name : s.name}</span></td>
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
              );
            })}
          </div>
        </Modal>
      )}
    </>
  );
}
