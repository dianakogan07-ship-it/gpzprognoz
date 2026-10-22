"use client";
import { useState } from "react";
import { Modal } from "./Modal";
import { api } from "./useReference";
import { IconUpload } from "./Icons";
import { formatGrowth } from "@/lib/indexFormat";
import { minstroyByRegion, parseMinstroy, type MinstroyFile } from "@/lib/minstroy";
import type { Reference } from "@/lib/types";
import { YearPicker } from "./MerImport";

/** Где и что скачать на ФГИС ЦС — показывается на вкладке «Стройка по регионам» */
export function MinstroyHowTo() {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
      <p className="font-medium text-slate-900">Как получить индексы Минстроя (раз в квартал)</p>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5">
        <li>Откройте <a className="text-brand hover:underline" href="https://fgiscs.minstroyrf.ru" target="_blank" rel="noreferrer">ФГИС ЦС</a> (может понадобиться VPN) → карточка «Сметные цены и индексы изменения сметной стоимости строительства».</li>
        <li>Выберите субъект, ценовую зону — достаточно «1 зона», квартал — последний опубликованный. Поле «Отраслевая организация» очистите крестиком.</li>
        <li>Перейдите на вкладку «Индексы к группам однородных строительных ресурсов» и нажмите «Скачать».</li>
        <li>Смените квартал на тот же квартал прошлого года и скачайте ещё раз.</li>
        <li>Загрузите оба файла сюда кнопкой «Загрузить файлы ФГИС ЦС» — можно сразу по нескольким регионам. Сервис сам посчитает рост за год.</li>
      </ol>
    </div>
  );
}

export function MinstroyImportButton({ reference, targetYear, onDone, disabled }: { reference: Reference; targetYear: number; onDone: (msg: string) => void; disabled?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ReturnType<typeof minstroyByRegion> | null>(null);
  const [year, setYear] = useState(targetYear);

  async function onFiles(fs: File[]) {
    setError(null);
    const parsed: MinstroyFile[] = [];
    const bad: string[] = [];
    for (const f of fs) {
      setBusy(`Чтение ${f.name}…`);
      await new Promise((r) => setTimeout(r, 30));
      try { parsed.push(parseMinstroy(await f.arrayBuffer(), f.name, reference.regions)); } catch (e) { bad.push(e instanceof Error ? e.message : String(e)); }
    }
    setBusy(null);
    if (bad.length) setError(bad.join(" "));
    if (parsed.length) { setRows(minstroyByRegion(parsed)); setYear(targetYear); }
  }

  const ready = (rows ?? []).filter((r) => r.region && r.value != null);
  async function save() {
    setBusy("Сохранение…");
    try {
      await api("/api/dict/price_indices/bulk", "POST", {
        rows: ready.map((r) => ({
          kind: "minstroy", key: r.region, year, month: null, value: Math.round(r.value! * 100000) / 100000, source_code: "FGIS_CS", approved: false,
          note: `ФГИС ЦС, индексы к группам однородных ресурсов, ${r.period}; зоны: ${r.zones.map((z) => z.zone).join("; ")}`,
        })),
      });
      setRows(null);
      onDone(`Индексы Минстроя загружены: регионов — ${ready.length}. Проверьте и утвердите их.`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  }
  const regionName = (c: string | null) => reference.regions.find((r) => r.code === c)?.name ?? "регион не определён";

  return (
    <>
      <label className={`btn-sec cursor-pointer ${busy || disabled ? "pointer-events-none opacity-50" : ""}`}><IconUpload />{busy && !rows ? busy : "Загрузить файлы ФГИС ЦС"}
        <input type="file" multiple accept=".xlsx,.xls" className="hidden" onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; if (fs.length) onFiles(fs); }} />
      </label>
      {error && !rows && <span className="text-sm text-red-600">{error}</span>}
      {rows && (
        <Modal wide title="Индексы Минстроя по регионам" subtitle={`Рост сметной стоимости за год — сохранится на ${year} год`} onClose={() => setRows(null)}
          footer={<><button className="btn-sec" onClick={() => setRows(null)}>Отмена</button>
            <button className="btn" disabled={!!busy || !ready.length} onClick={save}>{busy ?? `Сохранить на проверку (${ready.length})`}</button></>}>
          <YearPicker value={year} onChange={setYear} hint="На какой год сохранить индексы. Обычно — год прогноза, следующий за кварталами в файлах." />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <p className="hint">Рост = стоимость корзины строительных ресурсов (материалы, оборудование, машины) в новом квартале к тому же кварталу годом раньше, по сметным ценам 2022 года как весам.</p>
          <table className="tbl">
            <thead><tr><th>Регион</th><th>Ценовые зоны и кварталы</th><th className="text-right">Рост за год</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i} className={r.region && r.value != null ? "" : "bg-amber-50"}>
                <td className="font-medium">{regionName(r.region)}</td>
                <td className="text-xs text-slate-600">{r.zones.map((z) => (
                  <p key={z.zone}>{z.zone}: {z.cur.quarter} кв. {z.cur.year}{z.prev ? ` к ${z.prev.quarter} кв. ${z.prev.year} (${z.common.toLocaleString("ru-RU")} ресурсов)` : " — нет файла за тот же квартал прошлого года"}</p>
                ))}</td>
                <td className="whitespace-nowrap text-right font-semibold">{r.value != null ? formatGrowth(r.value) : "—"}</td>
              </tr>))}</tbody>
          </table>
        </Modal>
      )}
    </>
  );
}
