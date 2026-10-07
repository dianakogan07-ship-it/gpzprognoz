"use client";
import { useState } from "react";
import { DictTable, type Col } from "@/components/DictTable";
import { useReference } from "@/components/useReference";

const name: Col[] = [{ key: "id", label: "№", width: "4rem" }, { key: "name", label: "Наименование" }];

const DICTS: { table: string; title: string; pk: string; cols: Col[]; help?: string }[] = [
  { table: "sources", title: "Источники", pk: "id", cols: [
    { key: "code", label: "Код" }, { key: "name", label: "Источник" }, { key: "url", label: "Ссылка" },
    { key: "kind", label: "Вид", type: ["to_december", "forecast", "cpi", "vat"] }, { key: "verified", label: "Проверен", type: "bool" }, { key: "note", label: "Примечание" }],
    help: "Перечень проверенных источников индексов. Индекс без утверждённого источника помечается как требующий согласования." },
  { table: "categories", title: "Категории", pk: "id", cols: name },
  { table: "purchase_types", title: "Типы закупок", pk: "id", cols: name },
  { table: "purchase_methods", title: "Способы закупок", pk: "id", cols: name },
  { table: "purchase_forms", title: "Формы закупок", pk: "id", cols: name },
  { table: "regions", title: "Регионы (ОКАТО)", pk: "code", cols: [{ key: "code", label: "Код ОКАТО", width: "8rem" }, { key: "name", label: "Регион" }] },
  { table: "okei", title: "ОКЕИ", pk: "code", cols: [{ key: "code", label: "Код" }, { key: "name", label: "Наименование" }, { key: "short", label: "Обозначение" }] },
  { table: "okved2", title: "Разделы ОКВЭД2", pk: "letter", cols: [{ key: "letter", label: "Раздел" }, { key: "name", label: "Наименование" }, { key: "div_from", label: "Классы с", type: "number" }, { key: "div_to", label: "по", type: "number" }],
    help: "Первые 2 цифры ОКПД2 соответствуют классу ОКВЭД2; по разделу подбирается прогнозный дефлятор МЭР, если нет индекса по ОКПД2." },
  { table: "okpd2", title: "ОКПД2", pk: "code", cols: [{ key: "code", label: "Код", width: "8rem" }, { key: "name", label: "Наименование" }],
    help: "Наименование используется как обезличенное название предмета. Можно загрузить полный классификатор (колонки code, name)." },
  { table: "ws_codes", title: "Коды WS", pk: "code", cols: [{ key: "code", label: "Код" }, { key: "name", label: "Наименование" }, { key: "category", label: "Категория" }, { key: "auto_added", label: "Добавлен из отчётности", type: "bool" }],
    help: "Новые коды добавляются автоматически при расчёте прогноза." },
  { table: "repeat_rules", title: "Повторяемость", pk: "id", cols: [{ key: "kind", label: "По", type: ["okpd2", "ws"] }, { key: "prefix", label: "Код / префикс" }, { key: "repeatable", label: "Повторяющаяся", type: "bool" }, { key: "note", label: "Примечание" }],
    help: "Правило с самым длинным совпавшим префиксом ОКПД2 побеждает; правило по коду WS важнее ОКПД2. Разовые закупки попадают в прогноз с пометкой «ориентир справочный»." },
];

export default function DirectoriesPage() {
  const { db } = useReference();
  const [cur, setCur] = useState(0);
  const d = DICTS[cur];
  return (
    <div className="flex gap-4">
      <aside className="w-52 shrink-0 space-y-1">
        {DICTS.map((x, i) => (
          <button key={x.table} onClick={() => setCur(i)} className={`block w-full rounded px-2 py-1 text-left text-sm ${i === cur ? "bg-blue-700 text-white" : "hover:bg-slate-200"}`}>{x.title}</button>
        ))}
      </aside>
      <section className="card min-w-0 flex-1">
        <h1 className="mb-2 text-lg font-semibold">{d.title}</h1>
        {db === false && <p className="mb-2 text-sm text-amber-700">База данных не подключена — справочник только для просмотра.</p>}
        <DictTable key={d.table} table={d.table} cols={d.cols} pk={d.pk} readOnly={db !== true} help={d.help} />
      </section>
    </div>
  );
}
