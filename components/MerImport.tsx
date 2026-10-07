"use client";
import { useMemo, useState } from "react";
import { Modal } from "./Modal";
import { api } from "./useReference";
import { IconUpload } from "./Icons";
import type { MerParseResult, MerRow } from "@/lib/mer/parse";
import { parseCodeInput } from "@/lib/mer/parse";
import { planMerCommit, type MerIncoming } from "@/lib/mer/plan";
import { formatGrowth, industryLabel } from "@/lib/indexFormat";
import type { PriceIndex, Reference } from "@/lib/types";

/** Лимит размера запроса на Vercel — больший PDF разбирается в браузере, на сервер уходит только текст нужных страниц */
const SERVER_LIMIT = 4 * 1024 * 1024;
const RELEVANT = /цен\S*\s+производител|дефлятор|потребительск\S*\s+цен|прогноз\S*\s+социально|одобрен/i;

type Edit = MerRow & { codeInput: string; percentInput: string; include: boolean };

const toPercent = (k: number | null) => (k == null ? "" : String(Math.round((k - 1) * 1000) / 10).replace(".", ","));

function problemsOf(e: Edit): string[] {
  const p: string[] = [];
  if (e.kind === "forecast" && !parseCodeInput(e.codeInput).length) p.push("укажите код ОКВЭД2: букву раздела или коды через «+»");
  if (e.kind === "forecast" && !e.indicator) p.push("выберите: ИЦП или дефлятор");
  const v = Number(e.percentInput.replace(",", ".").replace("−", "-"));
  if (e.percentInput.trim() === "" || !Number.isFinite(v) || v <= -100 || v > 200) p.push("укажите рост в процентах");
  return p;
}

export function MerImportButton({ reference, targetYear, onDone, disabled }: {
  reference: Reference; targetYear: number; onDone: (msg: string) => void; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MerParseResult | null>(null);
  const [rows, setRows] = useState<Edit[]>([]);
  const [doc, setDoc] = useState({ title: "", date: "" });
  const [fileName, setFileName] = useState("");

  async function onFile(f: File) {
    setBusy(true); setError(null); setFileName(f.name);
    try {
      let res: Response;
      const isPdf = f.name.toLowerCase().endsWith(".pdf");
      if (isPdf && f.size > SERVER_LIMIT) {
        const { pdfToPages } = await import("@/lib/mer/pdf");
        let after = 0;
        const pages = await pdfToPages(new Uint8Array(await f.arrayBuffer()), (text) => {
          if (RELEVANT.test(text)) { after = 2; return true; }
          return after-- > 0;
        });
        res = await fetch(`/api/indices/mer/parse?year=${targetYear}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pages }) });
      } else {
        const fd = new FormData();
        fd.append("file", f);
        res = await fetch(`/api/indices/mer/parse?year=${targetYear}`, { method: "POST", body: fd });
      }
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      const r = j as MerParseResult;
      setResult(r);
      setDoc({ title: r.title ?? "", date: r.approvedDate ?? "" });
      // Сначала разобранные строки, неоднозначные — в конце
      setRows([...r.rows].sort((a, b) => Number(a.problems.length > 0) - Number(b.problems.length > 0)).map((x) => ({ ...x, codeInput: x.kind === "cpi" ? "" : x.codeText.replace(/^Раздел\s+/, ""), percentInput: toPercent(x.value), include: !x.problems.length })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  const incoming = (e: Edit): MerIncoming[] => {
    const v = 1 + Number(e.percentInput.replace(",", ".").replace("−", "-")) / 100;
    const keys = e.kind === "cpi" ? [null] : parseCodeInput(e.codeInput);
    return keys.map((key) => ({
      kind: e.kind, key, year: targetYear, value: Math.round(v * 100000) / 100000, indicator: e.kind === "cpi" ? null : e.indicator,
      ref_deflator: e.deflator, raw_line: e.raw, doc_page: e.page,
    }));
  };
  // Один код не может прийти из двух строк — вторая требует правки
  const taken = new Set<string>();
  const edits = rows.map((e) => {
    const problems = problemsOf(e);
    if (!problems.length && e.include) {
      const keys = e.kind === "cpi" ? ["ИПЦ"] : parseCodeInput(e.codeInput);
      const dup = keys.filter((k) => taken.has(k));
      if (dup.length) problems.push(`${e.kind === "cpi" ? "ИПЦ" : `код ${dup.join(", ")}`} уже есть в строке выше`);
      else keys.forEach((k) => taken.add(k));
    }
    return { e, problems };
  });
  const ready = edits.filter((x) => x.e.include && !x.problems.length);
  const plan = useMemo(() => planMerCommit(reference.indices as PriceIndex[], ready.flatMap((x) => incoming(x.e))), [reference, ready.length, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = { insert: 0, update: 0, version: 0, same: 0 };
  for (const a of plan) counts[a.type]++;

  async function save() {
    setBusy(true); setError(null);
    try {
      const r = await api("/api/indices/mer/commit", "POST", { doc, rows: ready.flatMap((x) => incoming(x.e)) });
      setResult(null);
      onDone(`Прогноз МЭР загружен: добавлено ${r.inserted}, обновлено ${r.updated}, новых версий ${r.versions}, без изменений ${r.unchanged}. Все значения ждут проверки.`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  const set = (id: string, p: Partial<Edit>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const changeOf = (e: Edit) => {
    const acts = planMerCommit(reference.indices as PriceIndex[], incoming(e));
    if (!acts.length) return "";
    const a = acts[0];
    return a.type === "insert" ? "новый" : a.type === "same" ? "без изменений" : a.type === "update" ? (a.change ? `обновится: ${a.change.replace(/^Было /, "было ")}` : "обновится") : `новая версия: ${a.change.toLowerCase()}`;
  };

  return (
    <>
      <label className={`btn-sec cursor-pointer ${busy || disabled ? "pointer-events-none opacity-50" : ""}`}><IconUpload />{busy && !result ? "Разбор файла…" : "Загрузить прогноз МЭР"}
        <input type="file" accept=".7z,.zip,.rar,.pdf,.xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
      </label>
      {error && !result && <span className="text-sm text-red-600">{error}</span>}
      {result && (
        <Modal wide title="Предпросмотр прогноза МЭР" subtitle={`${fileName} · значения на ${targetYear} год`} onClose={() => setResult(null)}
          footer={<>
            <span className="mr-auto self-center text-sm text-slate-600">
              Будет сохранено: новых {counts.insert}, обновится {counts.update}, новых версий {counts.version}{counts.same ? `, без изменений ${counts.same}` : ""}
            </span>
            <button className="btn-sec" onClick={() => setResult(null)}>Отмена</button>
            <button className="btn" disabled={busy || !ready.length || !doc.title.trim()} onClick={save}>{busy ? "Сохранение…" : `Сохранить на проверку (${ready.length})`}</button>
          </>}>
          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">Не удалось сохранить: {error}</p>}
          {result.warnings.length > 0 && (
            <ul className="space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          )}
          <div className="grid gap-3 md:grid-cols-[1fr_14rem]">
            <div><label className="field-label" htmlFor="mer-title">Документ</label>
              <input id="mer-title" className="inp py-2" value={doc.title} placeholder="Название документа" onChange={(e) => setDoc({ ...doc, title: e.target.value })} /></div>
            <div><label className="field-label" htmlFor="mer-date">Дата одобрения</label>
              <input id="mer-date" className="inp py-2" value={doc.date} placeholder="например, 18 сентября 2025" onChange={(e) => setDoc({ ...doc, date: e.target.value })} /></div>
          </div>
          <p className="hint">Все значения сохранятся со статусом «Нужна проверка». Подтверждённые индексы не затираются — если значение изменилось, появится новая версия. Строки, выделенные жёлтым, разобраны неоднозначно: исправьте их или оставьте без отметки.</p>
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200">
            <table className="tbl table-fixed">
              <colgroup><col className="w-10" /><col className="w-40" /><col className="w-32" /><col className="w-28" /><col className="w-24" /><col /><col className="w-44" /></colgroup>
              <thead><tr><th /><th>Вид деятельности</th><th>Показатель</th><th>Рост, %</th><th>Дефлятор</th><th>Строка в документе</th><th>Что изменится</th></tr></thead>
              <tbody>
                {edits.map(({ e, problems }) => {
                  const keys = e.kind === "forecast" ? parseCodeInput(e.codeInput) : [];
                  return (
                    <tr key={e.id} className={problems.length ? "bg-amber-50" : ""}>
                      <td><input type="checkbox" aria-label="Сохранять" checked={e.include && !problems.length} disabled={problems.length > 0} onChange={(ev) => set(e.id, { include: ev.target.checked })} /></td>
                      <td>
                        {e.kind === "cpi" ? <span className="font-medium">Общая инфляция (ИПЦ)</span> : (
                          <>
                            <input className="inp" value={e.codeInput} placeholder="B или 06+09" onChange={(ev) => set(e.id, { codeInput: ev.target.value, include: true })} />
                            {keys.length > 0 && <p className="mt-1 text-xs text-slate-500">{keys.map((k) => industryLabel(k, reference)).join("; ")}</p>}
                          </>
                        )}
                      </td>
                      <td>
                        {e.kind === "cpi" ? "ИПЦ" : (
                          <select className="inp" value={e.indicator ?? ""} onChange={(ev) => set(e.id, { indicator: (ev.target.value || null) as Edit["indicator"], include: true })}>
                            <option value="">— выберите —</option><option value="icp">ИЦП</option><option value="deflator">Дефлятор</option>
                          </select>
                        )}
                      </td>
                      <td><input className="inp" inputMode="decimal" value={e.percentInput} onChange={(ev) => set(e.id, { percentInput: ev.target.value, include: true })} /></td>
                      <td className="text-slate-500">{e.deflator ? formatGrowth(e.deflator) : "—"}</td>
                      <td className="text-xs text-slate-600">
                        <div className="whitespace-pre-line break-words">{e.raw}</div>
                        <div className="mt-0.5 text-slate-400">{e.page}</div>
                        {problems.length > 0 && <div className="mt-1 font-medium text-amber-800">{problems.join("; ")}</div>}
                      </td>
                      <td className="text-xs text-slate-600">{problems.length ? "—" : changeOf(e)}</td>
                    </tr>
                  );
                })}
                {!edits.length && <tr><td colSpan={7} className="py-8 text-center text-slate-500">В файле не найдено значений</td></tr>}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </>
  );
}
