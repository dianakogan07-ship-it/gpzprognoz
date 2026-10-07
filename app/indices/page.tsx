"use client";
import { useState } from "react";
import { DictTable } from "@/components/DictTable";
import { api, useReference } from "@/components/useReference";
import { IconDownload, IconUpload } from "@/components/Icons";
import { downloadWorkbook, indexTemplate, parseIndexFile } from "@/lib/excel";

export default function IndicesPage() {
  const { db, reference, reload } = useReference();
  const [msg, setMsg] = useState<string | null>(null);
  const [v, setV] = useState(0);
  const sources = reference?.sources.map((s) => s.code) ?? [];

  async function importFile(f: File) {
    const { rows, errors } = parseIndexFile(await f.arrayBuffer());
    try {
      const r = rows.length ? await api("/api/dict/price_indices/bulk", "POST", { rows }) : { saved: 0 };
      setMsg([`Загружено индексов: ${r.saved}`, ...errors].join("\n"));
      await reload(); setV(v + 1);
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="card space-y-3">
      <h1 className="text-xl font-semibold text-slate-900">Индексы роста цен</h1>
      <div className="space-y-1 text-sm text-slate-600">
        <p><b>to_december</b> — ИЦП Росстата: коэффициент доведения цены договора, заключённого в указанном месяце, до уровня декабря базового года (по ОКПД2).</p>
        <p><b>forecast</b> — прогнозный индекс-дефлятор МЭР на прогнозный год: по префиксу ОКПД2 («43», «43.2») или по букве раздела ОКВЭД2 («F»).</p>
        <p><b>cpi</b> — прогноз ИПЦ на год: применяется, если отраслевой индекс не найден; такие позиции помечаются «требует согласования».</p>
        <p>Коэффициент 1,12 = рост 12%. Неутверждённые индексы также дают пометку «требует согласования».</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-sec" disabled={!reference} onClick={() => reference && downloadWorkbook(indexTemplate(reference.indices), "Индексы.xlsx")}><IconDownload />Выгрузить индексы</button>
        {db && <label className="btn-sec cursor-pointer"><IconUpload />Загрузить индексы<input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} /></label>}
      </div>
      {msg && <pre className="whitespace-pre-wrap text-sm">{msg}</pre>}
      <DictTable key={v} table="price_indices" pk="id" readOnly={db !== true} cols={[
        { key: "kind", label: "Вид", type: ["to_december", "forecast", "cpi"] },
        { key: "key", label: "ОКПД2 / ОКВЭД2" },
        { key: "year", label: "Год", type: "number", width: "5rem" },
        { key: "month", label: "Месяц", type: "number", width: "5rem" },
        { key: "value", label: "Коэффициент", type: "number", width: "7rem" },
        { key: "source_code", label: "Источник", type: sources },
        { key: "approved", label: "Утверждён", type: "bool" },
        { key: "note", label: "Примечание" },
      ]} />
    </div>
  );
}
