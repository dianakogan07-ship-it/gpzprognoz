"use client";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/components/useReference";
import { MultiSelect } from "@/components/MultiSelect";
import { fmtDateTime } from "@/lib/forecasts/client";
import { EVENT_TITLE, FIELD_TITLE, STATUS_TITLE, type ForecastStatus, type VersionStats } from "@/lib/forecasts/model";
import { fmtGrowth, fmtRub, matchesOkpd } from "@/lib/forecastView";

interface Version { id: number; number: number; status: ForecastStatus; comment: string | null; stats: VersionStats; author: string; created_at: string }
interface Event { id: number; version: number | null; okpd2: string | null; subject: string | null; event_type: string; field: string | null; old_value: string | null; new_value: string | null; reason: string | null; author: string; created_at: string }

function value(field: string | null, v: string | null) {
  if (v == null) return "—";
  if (field === "forecast_price") return fmtRub(Number(v));
  if (field === "index_value") return fmtGrowth(Math.round((Number(v) - 1) * 1000) / 10);
  if (field === "status") return STATUS_TITLE[v as ForecastStatus] ?? v;
  return v;
}

export default function HistoryPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const [title, setTitle] = useState("");
  const [data, setData] = useState<{ versions: Version[]; events: Event[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [okpd, setOkpd] = useState("");

  useEffect(() => {
    setOkpd(new URLSearchParams(window.location.search).get("okpd") ?? "");
    Promise.all([api(`/api/forecasts/${id}`, "GET"), api(`/api/forecasts/${id}/history`, "GET")])
      .then(([f, h]) => { setTitle(f.title); setData(h); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const events = useMemo(() => (data?.events ?? []).filter((e) => (!types.length || types.includes(e.event_type)) && (!okpd.trim() || (e.okpd2 != null && matchesOkpd(e.okpd2, okpd)))), [data, types, okpd]);
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="hint">Загрузка…</p>;
  const typeCounts = new Map<string, number>();
  for (const e of data.events) typeCounts.set(e.event_type, (typeCounts.get(e.event_type) ?? 0) + 1);

  return (
    <div className="space-y-4">
      <Breadcrumbs items={[{ label: "Прогнозы", href: "/" }, { label: title, href: `/forecasts/${id}` }, { label: "История" }]} />
      <h1 className="text-xl font-semibold text-slate-900">История прогноза</h1>
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="card space-y-3 self-start">
          <p className="font-semibold text-slate-900">Версии</p>
          <ul className="space-y-3">
            {data.versions.map((v) => (
              <li key={v.id} className="border-l-2 border-brand/30 pl-3">
                <div className="flex items-center gap-2">
                  <Link href={`/forecasts/${id}?v=${v.id}`} className="font-medium text-brand hover:underline">v{v.number}</Link>
                  <span className="text-xs text-slate-500">{STATUS_TITLE[v.status]} · {fmtDateTime(v.created_at)}</span>
                </div>
                {v.comment && <p className="text-sm text-slate-700">{v.comment}</p>}
                <p className="text-xs text-slate-500">рост {fmtGrowth(v.stats.growth ?? 0)} · правок {v.stats.edits ?? 0} · {v.author}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="card space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-2 font-semibold text-slate-900">События</p>
            <MultiSelect label="Тип события" value={types} onChange={setTypes}
              options={[...typeCounts.entries()].map(([t, n]) => ({ value: t, label: EVENT_TITLE[t] ?? t, count: n }))} />
            <input className="inp w-40 py-1.5" placeholder="Код ОКПД2" value={okpd} onChange={(e) => setOkpd(e.target.value)} />
            {(types.length > 0 || okpd) && <button className="text-sm text-slate-500 hover:underline" onClick={() => { setTypes([]); setOkpd(""); }}>Сбросить</button>}
            <span className="hint ml-auto">Показано {events.length} из {data.events.length}</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {events.map((e) => (
              <li key={e.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-slate-900">{EVENT_TITLE[e.event_type] ?? e.event_type}</span>
                  {e.version && <span className="text-xs text-slate-500">v{e.version}</span>}
                  <span className="ml-auto text-xs text-slate-500">{fmtDateTime(e.created_at)} · {e.author}</span>
                </div>
                {e.okpd2 && <p className="text-slate-700">{e.subject ?? ""} <span className="text-xs text-slate-400">{e.okpd2}</span></p>}
                {e.field && <p className="text-slate-700">{FIELD_TITLE[e.field] ?? e.field}: {value(e.field, e.old_value)} → <b>{value(e.field, e.new_value)}</b></p>}
                {!e.field && e.new_value && <p className="text-slate-600">{e.new_value}</p>}
                {e.reason && <p className="text-slate-600">Причина: {e.reason}</p>}
              </li>
            ))}
            {!events.length && <li className="py-8 text-center text-slate-500">Нет событий по выбранным фильтрам</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
