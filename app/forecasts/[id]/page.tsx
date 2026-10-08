"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, type MenuItem } from "@/components/Menu";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, useReference } from "@/components/useReference";
import { ForecastTable, useForecastFilters } from "@/components/ForecastTable";
import { ForecastReport } from "@/components/ForecastReport";
import { Modal } from "@/components/Modal";
import { PromptModal } from "@/components/PromptModal";
import { exportRows, fmtDate, fmtDateTime, loadVersionRows } from "@/lib/forecasts/client";
import { PICK_STATUSES, STATUS_TITLE, isFrozen, type ForecastStatus, type SnapshotIndex, type VersionStats } from "@/lib/forecasts/model";
import { toViewRows, fmtGrowth, fmtRub, plural, type ViewRow } from "@/lib/forecastView";
import { formatGrowth, industryLabel, MONTHS } from "@/lib/indexFormat";
import type { ExcludedRow, ForecastRow } from "@/lib/forecast";
import type { RowMeta } from "@/lib/forecastView";

interface Version { id: number; number: number; status: ForecastStatus; comment: string | null; stats: VersionStats; created_at: string; author: string; indices: number }
interface Forecast { id: number; title: string; year: number; base_year: number; status: ForecastStatus; current_version_id: number; updated_at: string; versions: Version[]; snapshot: SnapshotIndex[]; excluded: ExcludedRow[]; newIndices: boolean }

const PILL: Record<ForecastStatus, string> = {
  draft: "bg-violet-100 text-violet-800", review: "bg-teal-100 text-teal-800", approved: "bg-emerald-100 text-emerald-800", rejected: "bg-rose-100 text-rose-800", archived: "bg-slate-200 text-slate-700",
};
const KIND_TITLE = { forecast: "Рост по отрасли", cpi: "Общая инфляция", to_december: "Пересчёт до декабря" } as const;

function EditModal({ v, frozen, onClose, onSave }: { v: ViewRow; frozen: boolean; onClose: () => void; onSave: (field: "forecast_price" | "index_value", value: number, reason: string) => Promise<void> }) {
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
      {frozen && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">Версия утверждена: правка сохранится в новой версии, утверждённая останется без изменений.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Modal>
  );
}

const fmtShort = (s: string) => new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }).replace(/\./g, "").replace(/\s*г$/, "");
const STATUS_WHEN: Record<ForecastStatus, string> = { draft: "в работе с", review: "на проверке с", approved: "утверждена", rejected: "отклонена", archived: "в архиве с" };

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
  const [showHistory, setShowHistory] = useState(false);
  const [tab, setTabState] = useState<"forecast" | "report">("forecast");
  useEffect(() => { if (new URLSearchParams(window.location.search).get("tab") === "report") setTabState("report"); }, []);
  // Вкладка — в адресе, фильтры при переключении сохраняются
  const setTab = (t: "forecast" | "report") => {
    setTabState(t);
    const p = new URLSearchParams(window.location.search);
    if (t === "report") p.set("tab", "report"); else p.delete("tab");
    window.history.replaceState(null, "", p.toString() ? `?${p}` : window.location.pathname);
    window.scrollTo({ top: 0 });
  };
  const [showExcluded, setShowExcluded] = useState(false);
  const router = useRouter();
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

  // Категория из ГПЗ, а если её нет — из справочника кодов WS
  const view = useMemo(() => (data ? toViewRows(data.rows.map((r) => (r.category || !r.ws ? r : { ...r, category: reference?.ws.find((w) => w.code === r.ws)?.category ?? null })), data.metas).map((v) => ({ ...v, status: v.meta?.reviewed ? "reliable" as const : "check" as const })) : []), [data, reference]);
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
  const setReviewed = (v: ViewRow, approved: boolean) => act(async () => {
    const r = await api(`/api/forecasts/${id}/items/${v.meta!.itemId}`, "PATCH", { field: "reviewed", value: approved, reason: approved ? "Статус «Утверждено»" : "Статус «Проверить»" });
    await load(r.newVersion?.versionId);
    if (r.newVersion) setMsg(`Версия была утверждена — изменения сохранены в новой версии v${r.newVersion.number}`);
  });

  const menu: MenuItem[] = [
    { label: "История", onClick: () => setShowHistory(true) },
    { label: "Сравнить", onClick: () => router.push(`/forecasts/${id}/compare`) },
    { label: "Индексы версии", onClick: () => setShowIdx(true) },
    { label: "Выгрузить в Excel", onClick: () => reference && exportRows(f.title, f.year, ver.number, data.rows, reference.sources) },
    ...(!archived ? [{ label: "Новая версия", onClick: () => setNewVer(true) }] : []),
    ...(isCurrent && !archived && f.status !== "review" && f.status !== "draft"
      ? [{ label: "В архив", onClick: () => { if (confirm("Перенести прогноз в архив?")) status("archived", "Прогноз перенесён в архив"); } }] : []),
  ];
  const when = isCurrent && ver.status !== "draft" ? f.updated_at : ver.created_at;

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-brand hover:underline print:hidden">← Прогнозы</Link>
      <div className="card space-y-3 print:hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">{f.title}</h1>
              <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${PILL[f.status]}`}>{STATUS_TITLE[f.status]}</span>
            </div>
            <p className="hint mt-1">
              Версия {ver.number} · {STATUS_WHEN[ver.status]} {fmtShort(when)} · база {f.base_year}
              {!isCurrent && <> · <button className="text-brand hover:underline" onClick={() => { setData(null); load(f.current_version_id); }}>только просмотр, открыть текущую</button></>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isCurrent && !archived && (
              <label className="flex items-center gap-2 text-sm text-slate-600">Статус
                <select className="inp w-auto py-1.5" value={PICK_STATUSES.includes(f.status) ? f.status : ""} disabled={busy}
                  onChange={(e) => {
                    const to = e.target.value as ForecastStatus;
                    if (to === "approved" && !confirm("Утвердить прогноз? Изменения после этого будут сохраняться новыми версиями.")) return;
                    status(to, to === "approved" ? "Прогноз утверждён" : to === "rejected" ? "Прогноз отклонён" : "Прогноз в работе");
                  }}>
                  {!PICK_STATUSES.includes(f.status) && <option value="" disabled>{STATUS_TITLE[f.status]}</option>}
                  {PICK_STATUSES.map((st) => <option key={st} value={st}>{STATUS_TITLE[st]}</option>)}
                </select>
              </label>
            )}
            <Menu items={menu}>⋯</Menu>
          </div>
        </div>

        <div className="-mb-1 flex gap-1 border-b border-slate-200">
          {([["forecast", "Прогноз"], ["report", "Отчёт"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${tab === k ? "border-brand text-brand" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{l}</button>
          ))}
        </div>

        {tab === "forecast" && <>
        <p className="text-sm text-slate-700">
          закупок {s.contracts} · позиций {s.items} · средний рост {fmtGrowth(s.growth)}
        </p>
        {s.excluded > 0 && (
          <p className="text-sm text-slate-500">
            {s.excluded} {plural(s.excluded, "строка", "строки", "строк")} из файлов не {plural(s.excluded, "попала", "попали", "попали")} в расчёт: по ним нет заключённого договора, цены или количества.{" "}
            {f.excluded.length > 0 && <button className="text-brand hover:underline" onClick={() => setShowExcluded(true)}>Посмотреть</button>}
          </p>
        )}

        {f.newIndices && isCurrent && !archived && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm text-amber-900">Появились новые индексы. Пересчёт создаст новую версию; ручные правки в неё не переносятся.</p>
            <button className="btn-sec" disabled={busy} onClick={() => act(async () => { const v = await api(`/api/forecasts/${id}/recalc`, "POST"); await load(v.versionId); }, "Прогноз пересчитан — создана новая версия")}>Пересчитать</button>
          </div>
        )}
        </>}
        {msg && <p className="text-sm text-slate-700">{msg}</p>}
      </div>

      {tab === "report" && reference && (
        <ForecastReport view={view} filters={filters} reference={reference} year={f.year} baseYear={f.base_year} title={f.title}
          approved={f.status === "approved"} approvedAt={f.status === "approved" ? f.updated_at : null}
          onExcel={(rows) => exportRows(f.title, f.year, ver.number, rows.map((v) => v.row), reference.sources, rows.length === view.length ? "" : " отбор")} />
      )}
      {tab === "forecast" && <ForecastTable view={view} filters={filters} baseYear={f.base_year} targetYear={f.year} sources={reference?.sources ?? []} showMeta
        onExport={(rows) => reference && exportRows(f.title, f.year, ver.number, rows.map((v) => v.row), reference.sources, rows.length === view.length ? "" : " отбор")}
        onEdit={editable ? setEditing : undefined}
        onReview={editable ? setReviewed : undefined}
        rowDetails={(v) => (
          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
            <Link href={`/forecasts/${id}/history?okpd=${encodeURIComponent(v.row.okpd2)}`} className="text-brand hover:underline">История изменений позиции</Link>
          </div>
        )} />}

      {editing && (
        <EditModal v={editing} frozen={frozen} onClose={() => setEditing(null)} onSave={async (field, value, reason) => {
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
      {showHistory && (
        <Modal title="История версий" subtitle={f.title} onClose={() => setShowHistory(false)}
          footer={<><Link href={`/forecasts/${id}/history`} className="btn-sec mr-auto">Журнал изменений</Link><button className="btn-sec" onClick={() => setShowHistory(false)}>Закрыть</button></>}>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {f.versions.map((v) => (
              <li key={v.id}>
                <button className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 ${v.id === versionId ? "bg-brand-light/40" : ""}`}
                  onClick={() => { setShowHistory(false); if (v.id !== versionId) { setData(null); load(v.id); } }}>
                  <span>
                    <span className="font-medium text-slate-900">Версия {v.number}</span>
                    <span className="ml-2 text-sm text-slate-600">{STATUS_TITLE[v.status]}{v.id === f.current_version_id ? " · текущая" : ""}</span>
                    {v.comment && <span className="block text-sm text-slate-500">«{v.comment}»</span>}
                  </span>
                  <span className="whitespace-nowrap text-sm text-slate-500">{fmtDate(v.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
      {showIdx && (
        <Modal wide title="Индексы версии" subtitle={`Версия ${ver.number} · ${f.snapshot.length}`} onClose={() => setShowIdx(false)}
          footer={<button className="btn-sec" onClick={() => setShowIdx(false)}>Закрыть</button>}>
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-200">
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
        </Modal>
      )}
      {showExcluded && (
        <Modal wide title="Не вошли в расчёт" subtitle={`${f.excluded.length} ${plural(f.excluded.length, "строка", "строки", "строк")} из файлов`} onClose={() => setShowExcluded(false)}
          footer={<button className="btn-sec" onClick={() => setShowExcluded(false)}>Закрыть</button>}>
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-200">
            <table className="tbl">
              <thead><tr><th>Файл</th><th className="text-right">Строка</th><th>Лот / закупка</th><th>Причина</th></tr></thead>
              <tbody>
                {f.excluded.map((e, i) => (
                  <tr key={i}><td>{e.file}</td><td className="text-right">{e.row}</td><td className="break-all">{e.lot ?? "—"}</td><td>{e.reason}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}
