"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, useReference } from "@/components/useReference";
import { Menu, type MenuItem } from "@/components/Menu";
import { PromptModal } from "@/components/PromptModal";
import { IconPlus } from "@/components/Icons";
import { exportVersion } from "@/lib/forecasts/client";
import { PICK_STATUSES, STATUS_TITLE, type CardColor, type ForecastStatus } from "@/lib/forecasts/model";
import { COLOR_CLASS, EditCard, HEAD } from "@/components/EditCard";
import type { ForecastCard } from "@/lib/forecasts/store";
import { plural } from "@/lib/forecastView";

type Sort = "year" | "updated" | "status";
const STATUS_ORDER: ForecastStatus[] = ["draft", "review", "approved", "rejected", "archived"];
const NBSP = "\u00a0";
const numRu = (n: number, d = 0) => n.toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/\s/g, NBSP);
/** Сумма в млн ₽ с двумя знаками, меньше миллиона — в тыс. ₽ */
const moneyOf = (n: number) => (Math.abs(n) >= 1e6 ? { value: numRu(n / 1e6, 2), unit: "млн" as const } : { value: numRu(n / 1e3, 0), unit: "тыс" as const });
const moneyIn = (n: number, unit: "млн" | "тыс") => (unit === "млн" ? numRu(n / 1e6, 2) : numRu(n / 1e3, 0));
const pctSigned = (g: number) => `${g < 0 ? "−" : "+"}${numRu(Math.abs(g), 1)}${NBSP}%`;

function Card({ c, onAction }: { c: ForecastCard; onAction: (c: ForecastCard, a: string) => void }) {
  const router = useRouter();
  const s = { ...c.stats, subjects: c.subjects, categories: c.categories };
  const money = moneyOf(s.forecastSum);
  const archived = c.status === "archived";
  const tail: MenuItem[] = [
    { label: "Изменить карточку", onClick: () => onAction(c, "edit") },
    ...(archived ? [] : [{ label: "Загрузить новые файлы", onClick: () => onAction(c, "files") }]),
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
      ...PICK_STATUSES.filter((st) => st !== c.status).map((st) => ({ label: `Статус: ${STATUS_TITLE[st].toLowerCase()}`, onClick: () => onAction(c, `status:${st}`) })),
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
        <p className="flex items-center gap-2 font-semibold text-slate-900">Прогноз на {c.year} год
          {s.needsReview > s.reviewed && (
            <span title="Есть позиции для подтверждения" aria-label="Есть позиции для подтверждения"
              className="flex h-5 w-5 cursor-help items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700">!</span>
          )}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Tile value={pctSigned(s.growth)} label="рост цен" tone={s.growth < 0 ? "text-red-700" : undefined} />
          <Tile value={`${money.value}${NBSP}${money.unit === "млн" ? "млн" : "тыс."}${NBSP}₽`} label="сумма цен позиций"
            note={`(в ${c.base_year} — ${moneyIn(s.baseSum, money.unit)})`} />
          <Tile value={s.subjects ? numRu(s.subjects) : numRu(s.items)} label={plural(s.subjects || s.items, "предмет закупки", "предмета закупки", "предметов закупки")}
            href={`/forecasts/${c.id}?group=subject`} />
          <Tile value={s.categories ? numRu(s.categories) : "—"} label={plural(s.categories ?? 0, "категория", "категории", "категорий")}
            href={`/forecasts/${c.id}?group=category`} title={s.categories ? undefined : "В файлах нет категорий"} />
        </div>
      </div>
    </div>
  );
}

/** Плитка итогов: крупное число и подпись */
function Tile({ value, label, note, tone, href, title }: { value: string; label: string; note?: string; tone?: string; href?: string; title?: string }) {
  const body = (
    <>
      <p className={`whitespace-nowrap text-xl font-semibold ${tone ?? "text-slate-900"}`}>{value}</p>
      <p className="text-xs leading-tight text-slate-500">{label}</p>
      {note && <p className="mt-0.5 text-[11px] text-slate-400">{note}</p>}
    </>
  );
  const cls = "min-w-0 rounded-lg bg-slate-50 px-3 py-2";
  return href
    ? <Link href={href} title={title} onClick={(e) => e.stopPropagation()} className={`${cls} transition hover:bg-brand-light hover:ring-1 hover:ring-brand/30`}>{body}</Link>
    : <div className={cls} title={title}>{body}</div>;
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
  const [editing, setEditing] = useState<{ c: ForecastCard; files: boolean } | null>(null);
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
      if (a === "edit") setEditing({ c, files: false });
      if (a === "files") setEditing({ c, files: true });
      if (a === "delete" && confirm(`Удалить прогноз «${c.title}» со всеми версиями и историей? Восстановить его будет нельзя.`)) {
        await api(`/api/forecasts/${c.id}`, "DELETE"); setMsg(`Прогноз «${c.title}» удалён`); await load();
      }
      if (a === "export" && reference) await exportVersion(c, c.version_id, c.version, reference.sources);
      if (a.startsWith("status:")) {
        const to = a.slice(7) as ForecastStatus;
        if (to !== "approved" || confirm(`Утвердить «${c.title}»? Изменения после этого будут сохраняться новыми версиями.`)) {
          await api(`/api/forecasts/${c.id}/status`, "POST", { to }); await load();
          setMsg(`«${c.title}»: статус «${STATUS_TITLE[to]}»`);
        }
      }
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
          <Link href="/logic" className="btn-sec">Логика расчётов</Link>
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

      {editing && reference && (
        <EditCard c={editing.c} reference={reference} focusFiles={editing.files} onClose={() => setEditing(null)}
          onSaved={async (m) => { setEditing(null); if (m) setMsg(m); await load(); }} />
      )}
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

