"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, useReference } from "@/components/useReference";
import { Menu, type MenuItem } from "@/components/Menu";
import { PromptModal } from "@/components/PromptModal";
import { IconPlus } from "@/components/Icons";
import { exportVersion, fmtDate } from "@/lib/forecasts/client";
import { CARD_COLORS, STATUS_TITLE, type CardColor, type ForecastStatus } from "@/lib/forecasts/model";
import { Modal } from "@/components/Modal";
import type { ForecastCard } from "@/lib/forecasts/store";
import { fmtGrowth, plural } from "@/lib/forecastView";

/** Цвета шапки, выбранные вручную (классы перечислены полностью, чтобы стили попали в сборку) */
const COLOR_CLASS: Record<CardColor, string> = {
  violet: "bg-violet-500", teal: "bg-teal-500", emerald: "bg-emerald-600", blue: "bg-blue-600",
  sky: "bg-sky-500", amber: "bg-amber-500", rose: "bg-rose-500", slate: "bg-slate-500",
};
const COLOR_TITLE: Record<CardColor, string> = {
  violet: "Сиреневый", teal: "Бирюзовый", emerald: "Зелёный", blue: "Синий", sky: "Голубой", amber: "Жёлтый", rose: "Розовый", slate: "Серый",
};
const HEAD: Record<ForecastStatus, string> = {
  draft: "bg-violet-500",
  review: "bg-teal-500",
  approved: "bg-emerald-600",
  archived: "bg-slate-400",
};
type Sort = "year" | "updated" | "status";
const STATUS_ORDER: ForecastStatus[] = ["draft", "review", "approved", "archived"];
const rub = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₽`;

function Progress({ value, label, tone }: { value: number; label: string; tone?: string }) {
  const color = tone ?? (value >= 100 ? "bg-emerald-500" : value >= 50 ? "bg-orange-400" : "bg-red-500");
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-600"><span>{label}</span><span className="font-medium text-slate-900">{Math.round(value)} %</span></div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>
    </div>
  );
}

function Card({ c, onAction }: { c: ForecastCard; onAction: (c: ForecastCard, a: string) => void }) {
  const router = useRouter();
  const [showAccuracy, setShowAccuracy] = useState(false);
  const s = c.stats;
  const reviewedPct = s.needsReview ? (s.reviewed / s.needsReview) * 100 : 100;
  const archived = c.status === "archived";
  const tail: MenuItem[] = [
    { label: "Изменить карточку", onClick: () => onAction(c, "edit") },
    { label: "Удалить", onClick: () => onAction(c, "delete"), danger: true },
  ];
  const items: MenuItem[] = archived
    ? [{ label: "Открыть", onClick: () => onAction(c, "open") }, { label: "История", onClick: () => onAction(c, "history") }, { label: "Сравнить", onClick: () => onAction(c, "compare") }, ...tail]
    : [
      { label: "Открыть", onClick: () => onAction(c, "open") },
      { label: "Новая версия", onClick: () => onAction(c, "version") },
      { label: "Сравнить", onClick: () => onAction(c, "compare") },
      { label: "История", onClick: () => onAction(c, "history") },
      { label: "Выгрузить в Excel", onClick: () => onAction(c, "export") },
      { label: "В архив", onClick: () => onAction(c, "archive") },
      ...tail,
    ];
  return (
    <div role="link" tabIndex={0} onClick={() => router.push(`/forecasts/${c.id}`)} onKeyDown={(e) => e.key === "Enter" && router.push(`/forecasts/${c.id}`)}
      className="flex cursor-pointer flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className={`${c.color && c.color in COLOR_CLASS ? COLOR_CLASS[c.color as CardColor] : HEAD[c.status]} px-5 py-4 text-white`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold" title={c.title}>{c.title}</p>
            <p className="mt-0.5 text-sm text-white/85">Прогноз на {c.year} · база {c.base_year} · v{c.version}</p>
          </div>
          <Menu light items={items} />
        </div>
        <span className="mt-2 inline-block rounded bg-white/20 px-2 py-0.5 text-xs font-medium">{STATUS_TITLE[c.status]}</span>
      </div>
      <div className="flex flex-1 flex-col gap-4 px-5 py-4">
        {c.newIndices && (
          <button className="self-start rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100"
            onClick={(e) => { e.stopPropagation(); onAction(c, "recalc"); }}>Новые индексы — пересчитать?</button>
        )}
        <div>
          <p className={`text-3xl font-semibold ${s.growth < 0 ? "text-red-700" : "text-slate-900"}`}>{fmtGrowth(s.growth)}</p>
          <p className="mt-1 text-xs text-slate-500">База {rub(s.baseSum)} → Прогноз {rub(s.forecastSum)}</p>
          <p className="mt-0.5 text-xs text-slate-500">{s.items} {plural(s.items, "позиция", "позиции", "позиций")} по {s.contracts} {plural(s.contracts, "договору", "договорам", "договорам")}</p>
        </div>
        <div>
          {c.actualRows > 0 && (
            <div className="mb-2 inline-flex rounded-lg bg-slate-100 p-0.5 text-xs" onClick={(e) => e.stopPropagation()}>
              {[["Проверено", false], ["Точность", true]].map(([l, v]) => (
                <button key={String(l)} className={`rounded-md px-2 py-0.5 ${showAccuracy === v ? "bg-white shadow-sm" : "text-slate-500"}`} onClick={() => setShowAccuracy(v as boolean)}>{l as string}</button>
              ))}
            </div>
          )}
          {showAccuracy && c.accuracy != null
            ? <Progress value={c.accuracy} label="Точность прогноза" tone="bg-sky-500" />
            : s.needsReview ? (
              <div title="Позиции, где нет отраслевого индекса или индекс не утверждён, помечаются «согласовать человеком». Здесь видно, сколько из них уже проверено.">
                <Progress value={reviewedPct} label={`Согласовано ${s.reviewed} из ${s.needsReview} ${plural(s.needsReview, "позиции", "позиций", "позиций")} с отметкой «проверить»`} />
              </div>
            )
            : <p className="text-sm text-emerald-700">Все позиции посчитаны по утверждённым отраслевым индексам — проверка не требуется</p>}
        </div>
        <button className="mt-auto self-start text-left text-xs text-slate-500 hover:text-brand hover:underline" onClick={(e) => { e.stopPropagation(); onAction(c, "history"); }}>
          изменён {fmtDate(c.updated_at)} · {s.edits} {plural(s.edits, "ручная правка", "ручные правки", "ручных правок")}
        </button>
      </div>
    </div>
  );
}

export default function ForecastsPage() {
  const router = useRouter();
  const { reference, db } = useReference();
  const [cards, setCards] = useState<ForecastCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "archive">("active");
  const [sort, setSort] = useState<Sort>("year");
  const [year, setYear] = useState<string>("");
  const [versionFor, setVersionFor] = useState<ForecastCard | null>(null);
  const [editing, setEditing] = useState<ForecastCard | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setCards(await api("/api/forecasts", "GET")); setError(null); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { if (db) load(); }, [db, load]);

  const years = useMemo(() => [...new Set((cards ?? []).map((c) => c.year))].sort(), [cards]);
  const shown = useMemo(() => {
    const now = new Date().getFullYear();
    const list = (cards ?? []).filter((c) => (tab === "archive" ? c.status === "archived" : c.status !== "archived") && (!year || c.year === Number(year)));
    return list.sort((a, b) =>
      sort === "updated" ? b.updated_at.localeCompare(a.updated_at)
      : sort === "status" ? STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.year - b.year
      // Ближайшие: сначала будущие годы по возрастанию, затем прошедшие от недавних
      : (a.year >= now ? 0 : 1) - (b.year >= now ? 0 : 1) || (a.year >= now ? a.year - b.year : b.year - a.year) || b.updated_at.localeCompare(a.updated_at));
  }, [cards, tab, sort, year]);
  const archivedCount = (cards ?? []).filter((c) => c.status === "archived").length;

  async function onAction(c: ForecastCard, a: string) {
    setMsg(null);
    try {
      if (a === "open") router.push(`/forecasts/${c.id}`);
      if (a === "history") router.push(`/forecasts/${c.id}/history`);
      if (a === "compare") router.push(`/forecasts/${c.id}/compare`);
      if (a === "version") setVersionFor(c);
      if (a === "edit") setEditing(c);
      if (a === "delete" && confirm(`Удалить прогноз «${c.title}» со всеми версиями и историей? Восстановить его будет нельзя.`)) {
        await api(`/api/forecasts/${c.id}`, "DELETE"); setMsg(`Прогноз «${c.title}» удалён`); await load();
      }
      if (a === "export" && reference) await exportVersion(c, c.version_id, c.version, reference.sources);
      if (a === "archive" && confirm(`Перенести «${c.title}» в архив? Изменить его будет нельзя.`)) {
        await api(`/api/forecasts/${c.id}/status`, "POST", { to: "archived" }); await load();
      }
      if (a === "recalc" && confirm("Пересчитать прогноз по новым индексам? Будет создана новая версия.")) {
        const v = await api(`/api/forecasts/${c.id}/recalc`, "POST");
        setMsg(`«${c.title}»: создана версия v${v.number}`); await load();
      }
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Прогнозы</h1>
        <div className="flex gap-2">
          <Link href="/directories" className="btn !bg-[#0f1b4c] hover:!bg-[#0a1338]">Справочники</Link>
          <Link href="/forecasts/new" className="btn"><IconPlus width={16} height={16} />Новый прогноз</Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg bg-white p-1 ring-1 ring-slate-200">
          {([["active", "Активные"], ["archive", `Архив${archivedCount ? ` (${archivedCount})` : ""}`]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-50"}`}>{l}</button>
          ))}
        </div>
        <select className="inp w-auto max-w-full py-1.5" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Сортировка">
          <option value="year">Год прогноза: сначала ближайшие</option>
          <option value="updated">По дате изменения</option>
          <option value="status">По статусу</option>
        </select>
        <select className="inp w-auto max-w-full py-1.5" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Год">
          <option value="">Все годы</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      {msg && <p className="text-sm text-slate-700">{msg}</p>}
      {db === false && <div className="card text-sm text-amber-800">Чтобы сохранять прогнозы, подключите базу данных в настройках проекта на Vercel.</div>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {db && !cards && !error && <p className="hint">Загрузка…</p>}

      {cards && shown.length === 0 && (
        <div className="card py-12 text-center">
          <p className="font-medium text-slate-900">{tab === "archive" ? "В архиве пока пусто" : "Прогнозов пока нет"}</p>
          {tab === "active" && <Link href="/forecasts/new" className="btn mt-4"><IconPlus width={16} height={16} />Новый прогноз</Link>}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((c) => <Card key={c.id} c={c} onAction={onAction} />)}
      </div>

      {editing && <EditCard c={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
      {versionFor && (
        <PromptModal title="Новая версия" subtitle={`${versionFor.title} · сейчас v${versionFor.version}`} label="Что меняется" placeholder="Например: уточнены цены по аренде" action="Создать версию"
          onClose={() => setVersionFor(null)}
          onSubmit={async (comment) => {
            const v = await api(`/api/forecasts/${versionFor.id}/versions`, "POST", { comment });
            setVersionFor(null); router.push(`/forecasts/${versionFor.id}?v=${v.versionId}`);
          }} />
      )}
    </div>
  );
}

function EditCard({ c, onClose, onSaved }: { c: ForecastCard; onClose: () => void; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState(c.title);
  const [color, setColor] = useState<string | null>(c.color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!title.trim()) return setError("Укажите название");
    setBusy(true); setError(null);
    try { await api(`/api/forecasts/${c.id}`, "PATCH", { title, color }); await onSaved(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  const swatch = (k: string | null, cls: string, label: string) => (
    <button key={label} type="button" title={label} aria-label={label} onClick={() => setColor(k)}
      className={`h-9 w-9 rounded-full ${cls} ring-offset-2 transition ${color === k ? "ring-2 ring-brand" : "hover:scale-110"}`} />
  );
  return (
    <Modal title="Карточка прогноза" subtitle={`Прогноз на ${c.year} · база ${c.base_year}`} onClose={onClose}
      footer={<><button className="btn-sec" onClick={onClose}>Отмена</button><button className="btn" disabled={busy} onClick={save}>{busy ? "Сохранение…" : "Сохранить"}</button></>}>
      <div><label className="field-label" htmlFor="ct">Название</label>
        <input id="ct" autoFocus className="inp py-2" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div>
        <span className="field-label">Цвет карточки</span>
        <div className="flex flex-wrap items-center gap-3">
          {swatch(null, `${HEAD[c.status]} bg-[linear-gradient(135deg,transparent_45%,white_45%,white_55%,transparent_55%)]`, "По статусу")}
          {CARD_COLORS.map((k) => swatch(k, COLOR_CLASS[k], COLOR_TITLE[k]))}
        </div>
        <p className="hint mt-2">{color ? "Цвет выбран вручную." : "Цвет меняется вместе со статусом: черновик — сиреневый, на проверке — бирюзовый, утверждён — зелёный."}</p>
      </div>
      <div className={`overflow-hidden rounded-lg ${color ? COLOR_CLASS[color as CardColor] : HEAD[c.status]} px-4 py-3 text-white`}>
        <p className="font-semibold">{title || "Без названия"}</p>
        <p className="text-sm text-white/85">Прогноз на {c.year} · база {c.base_year} · v{c.version}</p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Modal>
  );
}
