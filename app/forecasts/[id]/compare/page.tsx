"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, useReference } from "@/components/useReference";
import { FilePick } from "@/components/FilePick";
import { IconUpload } from "@/components/Icons";
import { parseGpz, parseReport } from "@/lib/parse";
import { buildForecast, groupKey } from "@/lib/forecast";
import { fmtDate } from "@/lib/forecasts/client";
import type { CompareRow, ForecastCard } from "@/lib/forecasts/store";
import { fmtGrowth, fmtRub } from "@/lib/forecastView";

type Tab = "versions" | "years" | "fact";
interface Version { id: number; number: number; comment: string | null; created_at: string }
interface Fc { id: number; title: string; year: number; base_year: number; current_version_id: number; versions: Version[] }
interface Cmp { rows: CompareRow[]; total: { common: number; changed: number; onlyA: number; onlyB: number; sumA: number; sumB: number; growth: number | null } }
interface Fact {
  rows: { okpd2: string; subject: string; unit: string; region: string | null; category: string | null; forecast: number; actual: number; errorPct: number | null }[];
  matched: number; forecastRows: number; actualRows: number; mape: number | null; accuracy: number | null; categories: { name: string; rows: number; mape: number | null }[];
}

const money = (n: number | null) => (n == null ? "—" : fmtRub(n));
const pct = (n: number | null) => (n == null ? "—" : fmtGrowth(n));

function CompareTable({ data, labelA, labelB }: { data: Cmp; labelA: string; labelB: string }) {
  const [limit, setLimit] = useState(200);
  const t = data.total;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <div><p className="hint">Общих позиций</p><p className="text-lg font-semibold">{t.common}</p></div>
        <div><p className="hint">Изменились</p><p className="text-lg font-semibold">{t.changed}</p></div>
        <div><p className="hint">Только в одной</p><p className="text-lg font-semibold">{t.onlyA + t.onlyB}</p><p className="text-xs text-slate-500">{labelA}: {t.onlyA} · {labelB}: {t.onlyB}</p></div>
        <div><p className="hint">Итог по общим позициям</p><p className="text-lg font-semibold">{pct(t.growth)}</p><p className="text-xs text-slate-500">{fmtRub(t.sumA)} → {fmtRub(t.sumB)}</p></div>
      </div>
      <div className="overflow-x-auto"><table className="tbl table-fixed min-w-[760px]">
        <colgroup><col /><col className="w-40" /><col className="w-36" /><col className="w-36" /><col className="w-32" /><col className="w-24" /></colgroup>
        <thead><tr><th>Предмет</th><th>Регион</th><th className="text-right">{labelA}</th><th className="text-right">{labelB}</th><th className="text-right">Разница</th><th className="text-right">%</th></tr></thead>
        <tbody>
          {data.rows.slice(0, limit).map((r) => (
            <tr key={r.key}>
              <td className="break-words"><div>{r.subject}</div><div className="text-xs text-slate-400">{r.okpd2} · {r.unit}</div></td>
              <td className="break-words text-slate-700">{r.region ?? "—"}</td>
              <td className="text-right">{money(r.a)}</td>
              <td className="text-right font-medium">{money(r.b)}</td>
              <td className={`text-right ${(r.delta ?? 0) < 0 ? "text-red-700" : ""}`}>{r.delta == null ? (r.a == null ? "новая" : "нет") : money(r.delta)}</td>
              <td className={`text-right ${(r.deltaPct ?? 0) < 0 ? "text-red-700" : ""}`}>{pct(r.deltaPct)}</td>
            </tr>
          ))}
          {!data.rows.length && <tr><td colSpan={6} className="py-8 text-center text-slate-500">Различий нет</td></tr>}
        </tbody>
      </table></div>
      {data.rows.length > limit && <div className="text-center"><button className="btn-sec" onClick={() => setLimit(limit + 200)}>Показать ещё</button></div>}
    </div>
  );
}

export default function ComparePage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const { reference } = useReference();
  const [f, setF] = useState<Fc | null>(null);
  const [tab, setTab] = useState<Tab>("versions");
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [cmp, setCmp] = useState<Cmp | null>(null);
  const [others, setOthers] = useState<ForecastCard[]>([]);
  const [other, setOther] = useState<number | null>(null);
  const [fact, setFact] = useState<Fact | null>(null);
  const [gpz, setGpz] = useState<File | null>(null);
  const [rep, setRep] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    if (t) setTab(t);
    Promise.all([api(`/api/forecasts/${id}`, "GET"), api("/api/forecasts", "GET"), api(`/api/forecasts/${id}/actuals`, "GET")]).then(([fc, list, fa]: [Fc, ForecastCard[], Fact]) => {
      setF(fc);
      setB(fc.current_version_id);
      setA(fc.versions[1]?.id ?? fc.current_version_id);
      const rest = list.filter((x) => x.id !== id).sort((x, y) => Math.abs(x.year - fc.year) - Math.abs(y.year - fc.year) || y.year - x.year);
      setOthers(rest);
      setOther(rest.find((x) => x.year !== fc.year)?.id ?? rest[0]?.id ?? null);
      if (fa.actualRows) setFact(fa);
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    p.set("tab", tab);
    window.history.replaceState(null, "", `?${p}`);
  }, [tab]);

  const loadCmp = useCallback(async () => {
    if (!f) return;
    setCmp(null); setError(null);
    try {
      if (tab === "versions" && a && b) setCmp(await api(`/api/forecasts/compare?a=${a}&b=${b}${onlyChanged ? "&changed=1" : ""}`, "GET"));
      if (tab === "years" && other) {
        const o = others.find((x) => x.id === other)!;
        const [first, second] = o.year <= f.year ? [o.version_id, f.current_version_id] : [f.current_version_id, o.version_id];
        setCmp(await api(`/api/forecasts/compare?a=${first}&b=${second}&byOkpd=1`, "GET"));
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [f, tab, a, b, onlyChanged, other, others]);
  useEffect(() => { loadCmp(); }, [loadCmp]);

  async function uploadFact() {
    if (!gpz || !rep || !reference || !f) return;
    setBusy(true); setError(null);
    try {
      const g = parseGpz(await gpz.arrayBuffer(), reference.regions.map((r) => r.code));
      const r = parseReport(await rep.arrayBuffer());
      // Фактические цены прогнозного года — медиана по тем же позициям, без индексации
      const res = buildForecast(g.rows, r.rows, reference, { baseYear: f.year, targetYear: f.year + 1 });
      const rows = res.rows.map((x) => ({ item_key: groupKey(x), okpd2: x.okpd2, subject: x.subject, category: x.category, actual_price: x.rawMedian, contracts: x.contracts }));
      if (!rows.length) throw new Error("В файлах не найдено заключённых договоров");
      setFact(await api(`/api/forecasts/${id}/actuals`, "POST", { rows }));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }

  if (!f) return error ? <p className="text-sm text-red-600">{error}</p> : <p className="hint">Загрузка…</p>;
  const verLabel = (vid: number | null) => `v${f.versions.find((v) => v.id === vid)?.number ?? "?"}`;
  const o = others.find((x) => x.id === other);
  const [ya, yb] = o ? (o.year <= f.year ? [o.year, f.year] : [f.year, o.year]) : [0, 0];

  return (
    <div className="space-y-4">
      <Link href={`/forecasts/${id}`} className="text-sm text-brand hover:underline">← {f.title}</Link>
      <h1 className="text-xl font-semibold text-slate-900">Сравнение</h1>
      <div className="inline-flex rounded-lg bg-white p-1 ring-1 ring-slate-200">
        {([["versions", "Версия ↔ версия"], ["years", "Год ↔ год"], ["fact", "Прогноз ↔ факт"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-50"}`}>{l}</button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {tab === "versions" && (
        <div className="card space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <select className="inp w-auto max-w-full py-1.5" value={a ?? ""} onChange={(e) => setA(Number(e.target.value))} aria-label="Первая версия">
              {f.versions.map((v) => <option key={v.id} value={v.id}>v{v.number} · {fmtDate(v.created_at)}</option>)}
            </select>
            <span className="text-slate-400">→</span>
            <select className="inp w-auto max-w-full py-1.5" value={b ?? ""} onChange={(e) => setB(Number(e.target.value))} aria-label="Вторая версия">
              {f.versions.map((v) => <option key={v.id} value={v.id}>v{v.number} · {fmtDate(v.created_at)}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />Только изменившиеся</label>
          </div>
          {f.versions.length < 2 && <p className="hint">У прогноза одна версия. Создайте новую версию, чтобы сравнить изменения.</p>}
          {cmp ? <CompareTable data={cmp} labelA={verLabel(a)} labelB={verLabel(b)} /> : <p className="hint">Загрузка…</p>}
        </div>
      )}

      {tab === "years" && (
        <div className="card space-y-4">
          {others.length ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-slate-600">{f.title} ({f.year}) и</span>
              <select className="inp w-auto max-w-full py-1.5" value={other ?? ""} onChange={(e) => setOther(Number(e.target.value))} aria-label="Прогноз для сравнения">
                {others.map((x) => <option key={x.id} value={x.id}>{x.title} · {x.year} · v{x.version}</option>)}
              </select>
              <span className="hint">Сравниваются ориентиры цены по одинаковым ОКПД2, единице и региону</span>
            </div>
          ) : <p className="hint">Нет других прогнозов для сравнения.</p>}
          {o && (cmp ? <CompareTable data={cmp} labelA={String(ya)} labelB={String(yb)} /> : <p className="hint">Загрузка…</p>)}
        </div>
      )}

      {tab === "fact" && (
        <div className="space-y-4">
          <div className="card space-y-4">
            <p className="text-sm text-slate-700">Загрузите ГПЗ и отчётность за {f.year} год — сервис сравнит фактические цены с прогнозом текущей версии.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><span className="field-label">ГПЗ {f.year}</span><FilePick label="Выберите файл ГПЗ .xlsx" hint="Годовой план закупок прогнозного года" file={gpz} onChange={setGpz} /></div>
              <div><span className="field-label">Отчётность {f.year}</span><FilePick label="Выберите файл отчётности .xlsx" hint="Заключённые договоры прогнозного года" file={rep} onChange={setRep} /></div>
            </div>
            <button className="btn" disabled={!gpz || !rep || busy} onClick={uploadFact}><IconUpload />{busy ? "Загрузка…" : fact ? "Заменить факт" : "Загрузить факт"}</button>
          </div>
          {fact && (
            <div className="card space-y-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <div><p className="hint">Точность прогноза</p><p className="text-2xl font-semibold text-sky-700">{fact.accuracy == null ? "—" : `${fact.accuracy.toLocaleString("ru-RU")} %`}</p></div>
                <div><p className="hint">Средняя ошибка (MAPE)</p><p className="text-lg font-semibold">{fact.mape == null ? "—" : `${fact.mape.toLocaleString("ru-RU")} %`}</p></div>
                <div><p className="hint">Совпало позиций</p><p className="text-lg font-semibold">{fact.matched} из {fact.forecastRows}</p><p className="text-xs text-slate-500">в факте {fact.actualRows}</p></div>
                <div><p className="hint">Больше всего ошибаемся</p>{fact.categories.slice(0, 3).map((c) => <p key={c.name} className="text-xs text-slate-700">{c.name}: {c.mape?.toLocaleString("ru-RU")} %</p>)}</div>
              </div>
              <div className="overflow-x-auto"><table className="tbl table-fixed min-w-[760px]">
                <colgroup><col /><col className="w-40" /><col className="w-36" /><col className="w-36" /><col className="w-28" /></colgroup>
                <thead><tr><th>Предмет</th><th>Регион</th><th className="text-right">Прогноз</th><th className="text-right">Факт</th><th className="text-right">Отклонение</th></tr></thead>
                <tbody>
                  {fact.rows.slice(0, 300).map((r, i) => (
                    <tr key={i}>
                      <td className="break-words"><div>{r.subject}</div><div className="text-xs text-slate-400">{r.okpd2} · {r.unit}{r.category ? ` · ${r.category}` : ""}</div></td>
                      <td className="break-words text-slate-700">{r.region ?? "—"}</td>
                      <td className="text-right">{fmtRub(r.forecast)}</td>
                      <td className="text-right font-medium">{fmtRub(r.actual)}</td>
                      <td className={`text-right ${Math.abs(r.errorPct ?? 0) > 15 ? "font-semibold text-red-700" : ""}`}>{pct(r.errorPct)}</td>
                    </tr>
                  ))}
                  {!fact.rows.length && <tr><td colSpan={5} className="py-8 text-center text-slate-500">Позиции факта не совпали с прогнозом</td></tr>}
                </tbody>
              </table></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
