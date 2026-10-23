"use client";
import Link from "next/link";
import { useState } from "react";
import { Modal } from "./Modal";
import { api } from "./useReference";
import { MerImportButton } from "./MerImport";
import { RosstatImportButton } from "./RosstatImport";
import { MinstroyImportButton } from "./MinstroyImport";
import { FRESH_RULE, type Stale } from "@/lib/freshness";
import { formatGrowth } from "@/lib/indexFormat";
import { isActiveIndex, type Reference } from "@/lib/types";
import { IconUpload } from "./Icons";
import type { CbrSurvey } from "@/lib/cbr";
import { surveyTitle, type CbrHistory } from "@/lib/cbrHistory";

/** Окно «Данные устарели»: по каждому источнику — почему пора обновить и кнопка загрузки (для инфляции ЦБ — поле) */
export function DataRefresh({ reference, year, baseYear, stale, onClose, onDone }: {
  reference: Reference; year: number; baseYear: number; stale: Stale[]; onClose: () => void; onDone: (msg: string) => Promise<void>;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const done = async (m: string) => { setMsg(m); await onDone(m); };
  return (
    <Modal wide title="Пора обновить данные" subtitle={`Для прогноза на ${year} год`} onClose={onClose}
      footer={<><Link href="/indices" className="mr-auto self-center text-sm text-brand hover:underline">Все индексы →</Link><button className="btn" onClick={onClose}>Закрыть</button></>}>
      {msg && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">{msg}</p>}
      <ul className="space-y-3">
        {stale.map((s) => (
          <li key={s.id} className="rounded-lg border border-slate-200 p-4">
            <p className="font-medium text-slate-900">{s.title}</p>
            <p className="text-sm text-amber-800">{s.reason}</p>
            <p className="hint">{FRESH_RULE[s.id]}.</p>
            <div className="mt-3">
              {s.id === "mer" && <MerImportButton reference={reference} targetYear={year} onDone={done} />}
              {s.id === "rosstat" && <RosstatImportButton reference={reference} baseYear={baseYear} onDone={done} />}
              {s.id === "minstroy" && <MinstroyImportButton reference={reference} targetYear={year} onDone={done} />}
              {s.id === "cbr" && <CbrField reference={reference} year={year} onDone={done} />}
            </div>
          </li>
        ))}
      </ul>
      <p className="hint">Загруженные значения попадают на проверку: утвердите их в разделе «Данные», затем пересчитайте прогноз кнопкой «Новые индексы — пересчитать?» на его карточке.</p>
    </Modal>
  );
}

/** Прогноз инфляции Банка России: ввести новое значение или подтвердить, что текущее не изменилось */
export function CbrField({ reference, year, onDone }: { reference: Reference; year: number; onDone: (m: string) => Promise<void> }) {
  const cur = reference.indices.find((i) => i.kind === "cpi" && i.year === year && isActiveIndex(i));
  const [pct, setPct] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(value: number, note: string) {
    setBusy(true); setError(null);
    try {
      await api("/api/dict/price_indices/bulk", "POST", { rows: [{ kind: "cpi", key: null, year, month: null, value, source_code: "CBR", approved: value === cur?.value ? cur.approved : false, note }] });
      await onDone(value === cur?.value ? "Прогноз инфляции подтверждён" : "Прогноз инфляции обновлён — утвердите его в разделе «Данные»");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  const n = Number(pct.replace(",", ".").replace("−", "-"));
  const date = new Date().toLocaleDateString("ru-RU");
  const [survey, setSurvey] = useState<CbrSurvey | null>(null);
  const [hist, setHist] = useState<{ year: number; date: string; value: number; on: boolean }[] | null>(null);
  async function onFile(f: File) {
    setBusy(true); setError(null); setSurvey(null); setHist(null);
    try {
      if (/\.xlsx?$/i.test(f.name)) {
        // История всех опросов: на каждый год — опрос, вышедший до ноября прошлого года (когда составляется ГПЗ)
        const { parseCbrHistory, surveyFor } = await import("@/lib/cbrHistory");
        const h: CbrHistory = parseCbrHistory(await f.arrayBuffer());
        const years = [...new Set(h.surveys.flatMap((x) => Object.keys(x.values).map(Number)))].sort((a, b) => b - a);
        setHist(years.flatMap((y) => { const sv = surveyFor(h, y); return sv && sv.date < `${y}-01-01` ? [{ year: y, date: sv.date, value: sv.values[y], on: y <= year }] : []; }));
        setBusy(false);
        return;
      }
      const { pdfToPages } = await import("@/lib/mer/pdf");
      const { parseCbrSurvey } = await import("@/lib/cbr");
      setSurvey(parseCbrSurvey(await pdfToPages(new Uint8Array(await f.arrayBuffer()))));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  async function saveHistory() {
    if (!hist) return;
    setBusy(true); setError(null);
    try {
      const rows = hist.filter((h) => h.on).map((h) => ({ kind: "cpi", key: null, year: h.year, month: null, value: Math.round((1 + h.value / 100) * 100000) / 100000, source_code: "CBR", approved: false,
        note: `Макроэкономический опрос Банка России, ${surveyTitle(h.date)}: инфляция в среднем за год, медиана` }));
      await api("/api/dict/price_indices/bulk", "POST", { rows });
      setHist(null);
      await onDone(`Прогноз инфляции Банка России сохранён на ${rows.length} ${rows.length === 1 ? "год" : rows.length < 5 ? "года" : "лет"} — утвердите в карточке «Банк России»`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  const sv = survey?.cpiAvg[year];
  const isFact = !!survey?.facts.includes(year);
  return (
    <div className="space-y-2 text-sm">
      <p className="text-slate-600">Скачайте на сайте <a className="text-brand hover:underline" href="https://www.cbr.ru/statistics/ddkp/mo_br/" target="_blank" rel="noreferrer">макроэкономический опрос Банка России</a> → внизу страницы «Агрегированные результаты опроса» (XLSX) и загрузите файл. В нём все прошлые опросы — сервис сам возьмёт прогноз на каждый год.</p>
      <label className={`btn-sec cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`}><IconUpload />{busy ? "Разбор файла…" : "Загрузить опрос (XLSX или PDF)"}
        <input type="file" accept=".xlsx,.xls,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
      </label>
      {survey && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-slate-700">Опрос {survey.date ? `от ${survey.date}` : "Банка России"}. Инфляция в среднем за год на {year}:{" "}
            <b className="text-slate-900">{sv != null ? `${String(sv).replace(".", ",")} %` : "нет в файле"}</b>
            {survey.cpiAvgPrev[year] != null && <span className="text-slate-500"> (в прошлом опросе {String(survey.cpiAvgPrev[year]).replace(".", ",")} %)</span>}</p>
          {isFact && <p className="text-amber-800">В этом опросе {year} год — уже факт, а не прогноз. Для прогноза на {year} загрузите опрос, вышедший осенью {year - 1} года.</p>}
          {sv != null && (
            <div className="flex gap-2">
              <button className="btn !py-1.5" disabled={busy} onClick={async () => { await save(Math.round((1 + sv / 100) * 100000) / 100000, `Макроэкономический опрос Банка России${survey.date ? ` от ${survey.date}` : ""}: инфляция в среднем за год, медиана${isFact ? " (факт)" : ""}`); setSurvey(null); }}>Сохранить {String(sv).replace(".", ",")} %</button>
              <button className="btn-sec !py-1.5" onClick={() => setSurvey(null)}>Отмена</button>
            </div>
          )}
        </div>
      )}
      {hist && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-slate-700">История опросов Банка России. На каждый год взят опрос, вышедший до ноября предыдущего года — когда составлялся ГПЗ. Инфляция в среднем за год, медиана:</p>
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500"><tr><th className="w-6" /><th className="text-left font-medium">Год прогноза</th><th className="text-left font-medium">Опрос</th><th className="text-right font-medium">Инфляция</th></tr></thead>
            <tbody>{hist.map((h) => (
              <tr key={h.year} className="border-t border-slate-200">
                <td><input type="checkbox" checked={h.on} onChange={() => setHist(hist.map((x) => (x.year === h.year ? { ...x, on: !x.on } : x)))} aria-label={`Сохранить ${h.year}`} /></td>
                <td className="py-1">{h.year}</td>
                <td className="py-1 text-slate-600">{surveyTitle(h.date)}</td>
                <td className="py-1 text-right font-medium">{String(h.value).replace(".", ",")} %</td>
              </tr>
            ))}</tbody>
          </table>
          <div className="flex gap-2">
            <button className="btn !py-1.5" disabled={busy || !hist.some((h) => h.on)} onClick={saveHistory}>Сохранить на проверку ({hist.filter((h) => h.on).length})</button>
            <button className="btn-sec !py-1.5" onClick={() => setHist(null)}>Отмена</button>
          </div>
        </div>
      )}
      <p className="text-xs text-slate-500">Или введите значение вручную{cur ? ` (сейчас в сервисе ${formatGrowth(cur.value)})` : ""}:</p>
      <div className="flex flex-wrap items-center gap-2">
        <input className="inp w-28 py-1.5" inputMode="decimal" placeholder="например, 4,2" value={pct} onChange={(e) => setPct(e.target.value)} aria-label="Инфляция, %" />
        <span className="text-slate-500">%</span>
        <button className="btn" disabled={busy || !pct.trim() || !Number.isFinite(n) || n <= -100} onClick={() => save(Math.round((1 + n / 100) * 100000) / 100000, `Прогноз Банка России, сверено ${date}`)}>Сохранить</button>
        {cur && <button className="btn-sec" disabled={busy} onClick={() => save(cur.value, `${cur.note ? `${cur.note}; ` : ""}сверено с Банком России ${date} — без изменений`)}>Не изменился</button>}
      </div>
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}
