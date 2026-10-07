"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseGpz, parseReport } from "@/lib/parse";
import { buildForecast, type ForecastRow } from "@/lib/forecast";
import { api, useReference } from "@/components/useReference";
import { FilePick } from "@/components/FilePick";
import { IconPlay } from "@/components/Icons";
import { COVERAGE_KEY, buildCoverage } from "@/lib/indexFormat";

const CHUNK = 300;

/** Договоры в строке — только цена и месяц: этого достаточно для пересчёта */
const slim = (r: ForecastRow) => ({ ...r, points: (r.points ?? []).map((p) => ({ raw: p.raw, month: p.month })) });

export default function NewForecastPage() {
  const router = useRouter();
  const { reference, db } = useReference();
  const now = new Date().getFullYear();
  const [title, setTitle] = useState("");
  const [year, setYear] = useState(now + 1);
  const [baseYear, setBaseYear] = useState(now);
  const [gpz, setGpz] = useState<File | null>(null);
  const [rep, setRep] = useState<File | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!gpz || !rep || !reference) return;
    setError(null);
    try {
      setStep("Чтение файлов и расчёт…");
      const g = parseGpz(await gpz.arrayBuffer(), reference.regions.map((r) => r.code));
      const r = parseReport(await rep.arrayBuffer());
      const result = buildForecast(g.rows, r.rows, reference, { baseYear, targetYear: year });
      if (!result.rows.length) throw new Error(`Ни одна строка не вошла в расчёт (не вошли: ${result.excluded.length}). Проверьте, что выбраны ГПЗ и отчётность одного года.`);
      try { localStorage.setItem(COVERAGE_KEY, JSON.stringify(buildCoverage(result.rows, year))); } catch { /* недоступно */ }
      if (result.newWsCodes.length) await api("/api/ws/auto", "POST", { codes: result.newWsCodes }).catch(() => null);
      setStep("Сохранение прогноза…");
      const { id, versionId } = await api("/api/forecasts", "POST", { title: title.trim() || `Прогноз ${year}`, year, baseYear });
      for (let i = 0; i < result.rows.length; i += CHUNK) {
        setStep(`Сохранение строк: ${Math.min(i + CHUNK, result.rows.length)} из ${result.rows.length}…`);
        await api(`/api/forecasts/${id}/items`, "POST", { versionId, rows: result.rows.slice(i, i + CHUNK).map(slim) });
      }
      await api(`/api/forecasts/${id}/finalize`, "POST", { versionId, gpzRows: g.rows.length, excluded: result.excluded.length });
      router.push(`/forecasts/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/" className="text-sm text-brand hover:underline">← Прогнозы</Link>
      <div className="card space-y-5">
        <h1 className="text-xl font-semibold text-slate-900">Новый прогноз</h1>
        {db === false && <p className="text-sm text-amber-700">Чтобы сохранять прогнозы, подключите базу данных.</p>}
        <div><label className="field-label" htmlFor="t">Название</label>
          <input id="t" className="inp py-2" placeholder={`Прогноз ${year}`} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="field-label" htmlFor="y">Год прогноза</label>
            <input id="y" type="number" className="inp py-2" value={year} onChange={(e) => { setYear(Number(e.target.value)); setBaseYear(Number(e.target.value) - 1); }} /></div>
          <div><label className="field-label" htmlFor="b">Базовый год</label>
            <input id="b" type="number" className="inp py-2" value={baseYear} onChange={(e) => setBaseYear(Number(e.target.value))} /></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><span className="field-label">ГПЗ {baseYear}</span><FilePick label="Выберите файл ГПЗ .xlsx" hint="Выгрузка годового плана закупок" file={gpz} onChange={setGpz} /></div>
          <div><span className="field-label">Отчётность {baseYear}</span><FilePick label="Выберите файл отчётности .xlsx" hint="Выгрузка заключённых договоров" file={rep} onChange={setRep} /></div>
        </div>
        <p className="hint">В сервисе сохраняются только обезличенные цены по предметам закупки — без заказчиков и контрагентов.</p>
        <button className="btn" disabled={!gpz || !rep || !reference || !db || !!step} onClick={run}><IconPlay width={16} height={16} />{step ?? "Рассчитать и сохранить"}</button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
