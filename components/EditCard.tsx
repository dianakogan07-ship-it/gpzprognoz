"use client";
import { useState } from "react";
import { Modal } from "./Modal";
import { api } from "./useReference";
import { FilePick } from "./FilePick";
import { CARD_COLORS, type CardColor, type ForecastStatus } from "@/lib/forecasts/model";
import { calcFromFiles, saveRows } from "@/lib/forecasts/client";
import type { ForecastCard } from "@/lib/forecasts/store";
import type { Reference } from "@/lib/types";

/** Цвета шапки, выбранные вручную (классы перечислены полностью, чтобы стили попали в сборку) */
export const COLOR_CLASS: Record<CardColor, string> = {
  violet: "bg-violet-500", teal: "bg-teal-500", emerald: "bg-emerald-600", blue: "bg-blue-600",
  sky: "bg-sky-500", amber: "bg-amber-500", rose: "bg-rose-500", slate: "bg-slate-500",
};
const COLOR_TITLE: Record<CardColor, string> = {
  violet: "Сиреневый", teal: "Бирюзовый", emerald: "Зелёный", blue: "Синий", sky: "Голубой", amber: "Жёлтый", rose: "Розовый", slate: "Серый",
};
export const HEAD: Record<ForecastStatus, string> = {
  draft: "bg-violet-500",
  review: "bg-teal-500",
  approved: "bg-emerald-600",
  archived: "bg-slate-400",
};

/** Карточка прогноза: название, цвет, годы и замена файлов ГПЗ и отчётности */
export function EditCard({ c, reference, focusFiles, onClose, onSaved }: {
  c: ForecastCard; reference: Reference; focusFiles?: boolean; onClose: () => void; onSaved: (msg?: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(c.title);
  const [color, setColor] = useState<string | null>(c.color);
  const [year, setYear] = useState(String(c.year));
  const [baseYear, setBaseYear] = useState(String(c.base_year));
  const [gpz, setGpz] = useState<File | null>(null);
  const [rep, setRep] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) return setError("Укажите название");
    const y = Number(year), b = Number(baseYear);
    if (!Number.isInteger(y) || !Number.isInteger(b) || y < 2000 || b < 2000) return setError("Укажите годы четырьмя цифрами");
    if (b >= y) return setError("Год базы должен быть раньше года прогноза");
    if (!!gpz !== !!rep) return setError("Выберите оба файла: ГПЗ и отчётность");
    setBusy("Сохранение…"); setError(null);
    try {
      if (title !== c.title || color !== c.color) await api(`/api/forecasts/${c.id}`, "PATCH", { title, color });
      let msg: string | undefined;
      if (gpz && rep) {
        setBusy("Чтение файлов…");
        const calc = await calcFromFiles(gpz, rep, reference, y, b);
        const v = await api(`/api/forecasts/${c.id}/data`, "POST", { year: y, baseYear: b });
        await saveRows(c.id, v.versionId, calc, setBusy);
        msg = `Загружены новые файлы: создана версия ${v.number}, в расчёте ${calc.result.rows.length} строк. Прежняя версия осталась в истории.`;
      } else if (y !== c.year || b !== c.base_year) {
        const r = await api(`/api/forecasts/${c.id}`, "PATCH", { year: y, baseYear: b });
        msg = `Годы изменены, прогноз пересчитан${r.newVersion ? ` — создана версия ${r.newVersion}` : ""}.`;
      }
      await onSaved(msg);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(null); }
  }
  const swatch = (k: string | null, cls: string, label: string) => (
    <button key={label} type="button" title={label} aria-label={label} onClick={() => setColor(k)}
      className={`h-9 w-9 rounded-full ${cls} ring-offset-2 transition ${color === k ? "ring-2 ring-brand" : "hover:scale-110"}`} />
  );
  return (
    <Modal title="Карточка прогноза" subtitle={`Прогноз на ${c.year} · база ${c.base_year}`} onClose={onClose}
      footer={<><button className="btn-sec" onClick={onClose}>Отмена</button><button className="btn" disabled={!!busy} onClick={save}>{busy ?? "Сохранить"}</button></>}>
      <div><label className="field-label" htmlFor="ct">Название</label>
        <input id="ct" autoFocus={!focusFiles} className="inp py-2" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
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
        <p className="text-sm text-white/85">Прогноз на {year} · база {baseYear} · v{c.version}</p>
      </div>
      <div className="space-y-3 border-t border-slate-200 pt-4">
        <span className="field-label">Данные прогноза</span>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="field-label" htmlFor="cy">Год прогноза</label>
            <input id="cy" autoFocus={focusFiles} inputMode="numeric" className="inp py-2" value={year} onChange={(e) => setYear(e.target.value)} /></div>
          <div><label className="field-label" htmlFor="cb">Год базы (отчётность)</label>
            <input id="cb" inputMode="numeric" className="inp py-2" value={baseYear} onChange={(e) => setBaseYear(e.target.value)} /></div>
        </div>
        <FilePick label="Новый файл ГПЗ" file={gpz} onChange={setGpz} />
        <FilePick label="Новый файл отчётности" hint="Исполненные договоры за год базы" file={rep} onChange={setRep} />
        <p className="hint">Новые файлы создадут новую версию прогноза, прежняя останется в истории. Если поменять только годы, прогноз пересчитается по тем же данным.</p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Modal>
  );
}
