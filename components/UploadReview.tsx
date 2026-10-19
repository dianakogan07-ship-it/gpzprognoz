"use client";
import Link from "next/link";
import type { UploadIssues } from "@/lib/forecasts/client";
import { fmtDateTime } from "@/lib/forecasts/client";

/** Проверка перед сохранением загрузки: повторные файлы, договоры следующего года, ставки НДС не 22 % */
export function UploadReview({ issues, trustVat, setTrustVat, newForecast }: { issues: UploadIssues; trustVat: boolean; setTrustVat: (v: boolean) => void; newForecast?: boolean }) {
  const vat = Object.entries(issues.vatOther).sort((a, b) => b[1] - a[1]);
  const vatRows = vat.reduce((s, [, n]) => s + n, 0);
  return (
    <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-medium">Проверьте перед сохранением</p>
      {issues.dupes.length > 0 && (
        <p>
          Эти файлы уже загружены:{" "}
          {issues.dupes.map((d, i) => (
            <span key={`${d.forecast_id}-${d.number}`}>{i > 0 && ", "}
              <Link className="text-brand hover:underline" href={`/forecasts/${d.forecast_id}`} target="_blank">«{d.title}», версия {d.number}</Link> ({fmtDateTime(d.created_at)})
            </span>
          ))}. {newForecast ? "Всё равно создать новый прогноз?" : "Создать ещё одну версию?"}
        </p>
      )}
      {issues.laterYear > 0 && (
        <p>{issues.laterYear} {issues.laterYear % 10 === 1 && issues.laterYear % 100 !== 11 ? "договор датирован" : "договоров датированы"} {issues.baseYear + 1} годом или позже, хотя отчётность за {issues.baseYear} год. Для них цена не пересчитывается внутри года — сразу применяется рост отрасли.</p>
      )}
      {vatRows > 0 && (
        <div className="space-y-2">
          <p>В {vatRows} {vatRows % 10 === 1 && vatRows % 100 !== 11 ? "строке" : "строках"} указана ставка НДС не 22 %: {vat.map(([r, n]) => `${r.replace(".", ",")} % — ${n}`).join(", ")}. По умолчанию в прогнозе будет 22 %.</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={trustVat} onChange={(e) => setTrustVat(e.target.checked)} />
            <span>Ставки в файле верные — применить их (например, 0 % при экспорте, 10 % для отдельных товаров)</span>
          </label>
        </div>
      )}
    </div>
  );
}
