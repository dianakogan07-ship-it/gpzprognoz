"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, useReference } from "@/components/useReference";
import { ForecastTable, useForecastFilters } from "@/components/ForecastTable";
import { Modal } from "@/components/Modal";
import { PromptModal } from "@/components/PromptModal";
import { exportRows, fmtDate, fmtDateTime, loadVersionRows } from "@/lib/forecasts/client";
import { STATUS_TITLE, isFrozen, type ForecastStatus, type SnapshotIndex, type VersionStats } from "@/lib/forecasts/model";
import { toViewRows, fmtGrowth, fmtRub, plural, type ViewRow } from "@/lib/forecastView";
import { formatGrowth, industryLabel, MONTHS } from "@/lib/indexFormat";
import type { ForecastRow } from "@/lib/forecast";
import type { RowMeta } from "@/lib/forecastView";

interface Version { id: number; number: number; status: ForecastStatus; comment: string | null; stats: VersionStats; created_at: string; author: string; indices: number }
interface Forecast { id: number; title: string; year: number; base_year: number; status: ForecastStatus; current_version_id: number; updated_at: string; versions: Version[]; snapshot: SnapshotIndex[]; newIndices: boolean }

const PILL: Record<ForecastStatus, string> = {
  draft: "bg-violet-100 text-violet-800", review: "bg-teal-100 text-teal-800", approved: "bg-emerald-100 text-emerald-800", archived: "bg-slate-200 text-slate-700",
};
const KIND_TITLE = { forecast: "Рост по отрасли", cpi: "Общая инфляция", to_december: "Пересчёт до декабря" } as const;

function EditModal({ v, onClose, onSave }: { v: ViewRow; onClose: () => void; onSave: (field: "forecast_price" | "index_value", value: number, reason: string) => Promise<void> }) {
  const [field, setField] = useState<"forecast_price" | "index_value">("forecast_price");
  const [value, setValue] = useState(String(v.row.forecastPrice).replace(".", ","));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const num = Number(value.replace(/\s/g, "").replace(",", ".").replace("−", "-"));
  const preview = field === "forecast_price" ? num : v.row.basePrice * (1 + num / 100);
  async function save() {
    if (!reason.trim()) return setError("Укажите причину правки — без неё изменение не сохранится");
    if (!Number.isFinite(num) || (field === "forecast_price" ? num <= 0 : num <= -100)) return setError("Проверьте значение");
    setBusy(true); setError(null);
    try { await onSave(field, field === "forecast_price" ? num : 1 + num / 100, reason.trim()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  return (
    <Modal title="Правка строки" subtitle={`${v.row.subject} · ${v.row.okpd2} · ${v.row.regionName ?? v.row.region ?? ""}`} onClose={onClose}
      footer={<><button className="btn-sec" onClick={onClose}>Отмена</button><button className="btn" disabled={busy} onClick={save}>{busy ? "Сохранение…" : "Сохранить"}</button></>}>
      <div className="flex gap-2">
        {([["forecast_price", "Прогнозная цена"], ["index_value", "Рост, %"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => { setField(k); setValue(k === "forecast_price" ? String(v.row.forecastPrice).replace(".", ",") : String(Math.round((v.row.forecastIndex - 1) * 1000) / 10).replace(".", ",")); }}
            className={`rounded-lg border px-3 py-1.5 text-sm ${field === k ? "border-brand bg-brand-light text-brand" : "border-slate-200 text-slate-600"}`}>{l}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><span className="field-label">Сейчас</span><p className="py-2 text-sm">{field === "forecast_price" ? fmtRub(v.row.forecastPrice) : fmtGrowth(v.growth)}</p></div>
        <div><label className="field-label" htmlFor="val">Новое значение</label><input id="val" autoFocus className="inp py-2" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></div>
      </div>
      {Number.isFinite(preview) && <p className="hint">Прогноз станет {fmtRub(Math.round(preview * 100) / 100)} (база {fmtRub(v.row.basePrice)})</p>}
      <div><label className="field-label" htmlFor="reason">Причина правки</label>
        <textarea id="reason" rows={2} className="inp py-2" placeholder="Например: уточнено по коммерческим предложениям" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Modal>
  );
}

export default function ForecastPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const { reference } = useReference();
  const filters = useForecastFilters();
  const [f, setF] = useState<Forecast | null>(null);
  const [versionId, setVersionId] = useState<number | null>(null);
  const [data, setData] = useState<{ rows: ForecastRow[]; metas: RowMeta[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<ViewRow | null>(null);
  const [newVer, setNewVer] = useState(false);
  const [showIdx, setShowIdx] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (vId?: number) => {
    try {
      const want0 = vId ?? (Number(new URLSearchParams(window.location.search).get("v")) || null);
      const fc = (await api(`/api/forecasts/${id}${want0 ? `?v=${want0}` : ""}`, "GET")) as Forecast;
      setF(fc);
      const want = want0 ?? fc.current_version_id;
      const v = fc.versions.find((x) => x.id === want) ?? fc.versions.find((x) => x.id === fc.current_version_id)!;
      setVersionId(v.id);
      const { rows, metas } = await loadVersionRows(id, v.id);
      setData({ rows, metas });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!versionId || !f) return;
    const p = new URLSearchParams(window.location.search);
    if (versionId === f.current_version_id) p.delete("v"); else p.set("v", String(versionId));
    window.history.replaceState(null, "", p.toString() ? `?${p}` : window.location.pathname);
  }, [versionId, f]);

  const view = useMemo(() => (data ? toViewRows(data.rows, data.metas) : []), [data]);
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!f || !data || !versionId) return <p className="hint">Загрузка…</p>;

  const ver = f.versions.find((v) => v.id === versionId)!;
  const isCurrent = versionId === f.current_version_id;
  const archived = f.status === "archived";
  const editable = isCurrent && !archived;
  const frozen = isFrozen(f.status);
  const s = ver.stats;

  async function act(fn: () => Promise<unknown>, done?: string) {
    setBusy(true); setMsg(null);
    try { await fn(); if (done) setMsg(done); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  const status = (to: ForecastStatus, done: string) => act(async () => { await api(`/api/forecasts/${id}/status`, "POST", { to }); await load(); }, done);
  const toggleReviewed = (v: ViewRow) => act(async () => {
    const r = await api(`/api/forecasts/${id}/items/${v.meta!.itemId}`, "PATCH", { field: "reviewed", value: !v.meta!.reviewed, reason: v.meta!.reviewed ? "Снята отметка проверки" : "Проверено" });
    await load(r.newVersion?.versionId);
    if (r.newVersion) setMsg(`Версия была утверждена — изменения сохранены в новой версии v${r.newVersion.number}`);
  });

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-brand hover:underline">← Прогнозы</Link>
      <div className="card space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">{f.title}</h1>
              <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${PILL[f.status]}`}>{STATUS_TITLE[f.status]}</span>
            </div>
            <p className="hint mt-1">Прогноз на {f.year} · база {f.base_year} · изменён {fmtDate(f.updated_at)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/forecasts/${id}/history`} className="btn-sec">История</Link>
            <Link href={`/forecasts/${id}/compare`} className="btn-sec">Сравнить</Link>
            <button className="btn-sec" onClick={() => reference && exportRows(f.title, f.year, ver.number, data.rows, reference.sources)}>Выгрузить в Excel</button>
            {!archived && <button className="btn-sec" onClick={() => setNewVer(true)}>Новая версия</button>}
            {isCurrent && f.status === "draft" && <button className="btn" disabled={busy} onClick={() => status("review", "Прогноз отправлен на проверку")}>На проверку</button>}
            {isCurrent && f.status === "review" && <>
              <button className="btn-sec" disabled={busy} onClick={() => status("draft", "Прогноз возвращён в черновик")}>Вернуть в черновик</button>
              <button className="btn" disabled={busy} onClick={() => confirm("Утвердить прогноз? Изменения после этого будут сохраняться новыми версиями.") && status("approved", "Прогноз утверждён")}>Утвердить</button>
            </>}
            {isCurrent && !archived && f.status !== "review" && f.status !== "draft" && <button className="btn-sec" disabled={busy} onClick={() => confirm("Перенести прогноз в архив?") && status("archived", "Прогноз перенесён в архив")}>В архив</button>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-slate-600" htmlFor="ver">Версия</label>
          <select id="ver" className="inp w-auto max-w-full py-1.5" value={versionId} onChange={(e) => { setData(null); load(Number(e.target.value)); }}>
            {f.versions.map((v) => <option key={v.id} value={v.id}>v{v.number} · {STATUS_TITLE[v.status]}{v.id === f.current_version_id ? " · текущая" : ""} · {fmtDate(v.created_at)}</option>)}
          </select>
          {ver.comment && <span className="text-sm text-slate-600">«{ver.comment}»</span>}
          {!isCurrent && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Только просмотр — это не текущая версия</span>}
        </div>

        {f.newIndices && isCurrent && !archived && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm text-amber-900">Появились новые индексы. Пересчёт создаст новую версию; ручные правки в неё не переносятся.</p>
            <button className="btn-sec" disabled={busy} onClick={() => act(async () => { const v = await api(`/api/forecasts/${id}/recalc`, "POST"); await load(v.versionId); }, "Прогноз пересчитан — создана новая версия")}>Пересчитать</button>
          </div>
        )}
        {frozen && isCurrent && !archived && <p className="hint">Версия утверждена: любая правка строки сохранится в новой версии.</p>}
        {msg && <p className="text-sm text-slate-700">{msg}</p>}

        <div className="grid gap-3 sm:grid-cols-4">
          <div><p className="hint">Позиций</p><p className="text-lg font-semibold">{s.items}</p><p className="text-xs text-slate-500">по {s.contracts} {plural(s.contracts, "договору", "договорам", "договорам")}{s.excluded ? ` · не вошли ${s.excluded}` : ""}</p></div>
          <div><p className="hint">Средний рост</p><p className="text-lg font-semibold">{fmtGrowth(s.growth)}</p><p className="text-xs text-slate-500">{fmtRub(s.baseSum)} → {fmtRub(s.forecastSum)}</p></div>
          <div><p className="hint">Проверено</p><p className="text-lg font-semibold">{s.needsReview ? `${s.reviewed} из ${s.needsReview}` : "не требуется"}</p></div>
          <div><p className="hint">Ручных правок</p><p className="text-lg font-semibold">{s.edits}</p>
            <button className="text-xs text-brand hover:underline" onClick={() => setShowIdx(!showIdx)}>{showIdx ? "Скрыть индексы версии" : `Индексы версии (${ver.indices})`}</button></div>
        </div>
        {showIdx && (
          <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
            <table className="tbl">
              <thead><tr><th>Вид</th><th>ОКПД2 / ОКВЭД2</th><th className="text-right">Значение</th><th>Источник</th><th>Получен</th></tr></thead>
              <tbody>
                {f.snapshot.map((i) => (
                  <tr key={`${i.kind}${i.key}${i.month}${i.id}`}>
                    <td>{KIND_TITLE[i.kind]}{i.month ? `, ${MONTHS[i.month - 1]}` : ""}{!i.approved && <span className="ml-1 text-xs text-amber-700">не утверждён</span>}</td>
                    <td>{i.key ? (reference ? industryLabel(i.key, reference) : i.key) : "—"}</td>
                    <td className="text-right">{formatGrowth(i.value)}</td>
                    <td>{i.url ? <a className="text-brand hover:underline" href={i.url} target="_blank" rel="noreferrer">{i.source}</a> : i.source ?? "—"}</td>
                    <td>{i.loadedAt ? fmtDateTime(i.loadedAt) : "—"}</td>
                  </tr>
                ))}
                {!f.snapshot.length && <tr><td colSpan={5} className="py-4 text-center text-slate-500">Индексов не было — прогноз посчитан без роста цен.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ForecastTable view={view} filters={filters} baseYear={f.base_year} sources={reference?.sources ?? []} showMeta
        onExport={(rows, all) => reference && exportRows(f.title, f.year, ver.number, rows.map((v) => v.row), reference.sources, all ? "" : " отбор")}
        rowActions={editable ? (v) => (
          <div className="flex flex-col items-end gap-1">
            <button className="text-xs font-medium text-brand hover:underline" onClick={() => setEditing(v)}>Изменить</button>
            {v.meta?.needsReview && <button className="text-xs text-slate-600 hover:underline" disabled={busy} onClick={() => toggleReviewed(v)}>{v.meta.reviewed ? "Снять отметку" : "Проверено"}</button>}
          </div>
        ) : undefined}
        rowDetails={(v) => <Link href={`/forecasts/${id}/history?okpd=${encodeURIComponent(v.row.okpd2)}`} className="mt-2 inline-block text-xs text-brand hover:underline">История изменений по {v.row.okpd2}</Link>} />

      {editing && (
        <EditModal v={editing} onClose={() => setEditing(null)} onSave={async (field, value, reason) => {
          const r = await api(`/api/forecasts/${id}/items/${editing.meta!.itemId}`, "PATCH", { field, value, reason });
          setEditing(null);
          await load(r.newVersion?.versionId);
          setMsg(r.newVersion ? `Версия была утверждена — правка сохранена в новой версии v${r.newVersion.number}` : "Правка сохранена");
        }} />
      )}
      {newVer && (
        <PromptModal title="Новая версия" subtitle={`Сейчас v${f.versions[0].number}`} label="Что меняется" placeholder="Например: уточнены цены по охране" action="Создать версию"
          onClose={() => setNewVer(false)}
          onSubmit={async (comment) => { const v = await api(`/api/forecasts/${id}/versions`, "POST", { comment }); setNewVer(false); await load(v.versionId); setMsg(`Создана версия v${v.number}`); }} />
      )}
    </div>
  );
}
