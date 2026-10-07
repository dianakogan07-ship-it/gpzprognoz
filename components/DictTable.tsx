"use client";
import { useEffect, useState } from "react";
import { api } from "./useReference";
import { parseSimpleSheet } from "@/lib/excel";

export type ColType = "text" | "number" | "bool" | string[];
export interface Col { key: string; label: string; type?: ColType; width?: string }
type Row = Record<string, unknown>;

function Field({ col, value, onChange }: { col: Col; value: unknown; onChange: (v: unknown) => void }) {
  const t = col.type ?? "text";
  if (t === "bool") return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
  if (Array.isArray(t)) return <select className="inp" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>{["", ...t].map((o) => <option key={o}>{o}</option>)}</select>;
  return <input className="inp" type={t === "number" ? "number" : "text"} step="any" value={value == null ? "" : String(value)}
    onChange={(e) => onChange(t === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)} />;
}

const show = (col: Col, v: unknown) => (col.type === "bool" ? (v ? "да" : "") : v == null ? "" : String(v));

export function DictTable({ table, cols, pk, readOnly, help }: { table: string; cols: Col[]; pk: string; readOnly: boolean; help?: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<{ pk: unknown; row: Row } | null>(null);
  const [draft, setDraft] = useState<Row>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = async () => setRows(await api(`/api/dict/${table}`, "GET"));
  useEffect(() => { load().catch((e) => setMsg(e.message)); setEdit(null); setDraft({}); setMsg(null); }, [table]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); await load(); setMsg(ok ?? null); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  const editable = cols.filter((c) => c.key !== "id");
  const filtered = q ? rows.filter((r) => cols.some((c) => show(c, r[c.key]).toLowerCase().includes(q.toLowerCase()))) : rows;

  async function bulk(f: File) {
    const data = parseSimpleSheet(await f.arrayBuffer());
    const keys = new Set(editable.map((c) => c.key));
    const clean = data.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => keys.has(k))));
    await act(() => api(`/api/dict/${table}/bulk`, "POST", { rows: clean }), `Загружено строк: ${clean.length}`);
  }

  return (
    <div className="space-y-2">
      {help && <p className="text-sm text-slate-600">{help}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input className="inp max-w-xs" placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-sm text-slate-500">Записей: {rows.length}</span>
        {!readOnly && (
          <label className="btn-sec cursor-pointer">Массовая загрузка из Excel
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && bulk(e.target.files[0])} />
          </label>
        )}
        {!readOnly && <span className="text-xs text-slate-500">Колонки файла: {editable.map((c) => c.key).join(", ")}</span>}
      </div>
      {msg && <p className="text-sm text-slate-700">{msg}</p>}
      <div className="max-h-[65vh] overflow-auto">
        <table className="tbl">
          <thead><tr>{cols.map((c) => <th key={c.key} style={{ width: c.width }}>{c.label}</th>)}{!readOnly && <th className="w-40" />}</tr></thead>
          <tbody>
            {!readOnly && (
              <tr className="bg-blue-50">
                {cols.map((c) => <td key={c.key}>{c.key === "id" ? "" : <Field col={c} value={draft[c.key]} onChange={(v) => setDraft({ ...draft, [c.key]: v })} />}</td>)}
                <td><button className="btn" onClick={() => act(() => api(`/api/dict/${table}`, "POST", draft), "Добавлено").then(() => setDraft({}))}>Добавить</button></td>
              </tr>
            )}
            {filtered.map((r) => {
              const isEdit = edit && edit.pk === r[pk];
              return (
                <tr key={String(r[pk])}>
                  {cols.map((c) => <td key={c.key}>{isEdit && c.key !== "id" ? <Field col={c} value={edit.row[c.key]} onChange={(v) => setEdit({ ...edit, row: { ...edit.row, [c.key]: v } })} /> : show(c, r[c.key])}</td>)}
                  {!readOnly && (
                    <td className="whitespace-nowrap">
                      {isEdit ? (
                        <>
                          <button className="btn" onClick={() => act(() => api(`/api/dict/${table}?pk=${encodeURIComponent(String(r[pk]))}`, "PUT", Object.fromEntries(editable.map((c) => [c.key, edit.row[c.key]]))), "Сохранено").then(() => setEdit(null))}>OK</button>{" "}
                          <button className="btn-sec" onClick={() => setEdit(null)}>Отмена</button>
                        </>
                      ) : (
                        <>
                          <button className="btn-sec" onClick={() => setEdit({ pk: r[pk], row: { ...r } })}>Изменить</button>{" "}
                          <button className="btn-sec" onClick={() => confirm("Удалить запись?") && act(() => api(`/api/dict/${table}?pk=${encodeURIComponent(String(r[pk]))}`, "DELETE"))}>✕</button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
