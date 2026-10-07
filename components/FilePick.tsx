"use client";
import { IconFile } from "./Icons";

/** Поле выбора файла в виде карточки с пунктирной рамкой */
export function FilePick({ label, hint, file, onChange, accept = ".xlsx,.xls" }: {
  label: string; hint?: string; file: File | null; onChange: (f: File | null) => void; accept?: string;
}) {
  return (
    <label className="dropzone">
      <IconFile className="mt-0.5 shrink-0 text-brand" width={22} height={22} />
      <span className="min-w-0">
        <span className="block font-medium text-slate-900">{file ? file.name : label}</span>
        <span className="block text-sm text-slate-500">{file ? `${(file.size / 1024).toFixed(0)} КБ · нажмите, чтобы заменить` : hint ?? "Выберите файл .xlsx"}</span>
      </span>
      <input type="file" accept={accept} className="hidden" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
    </label>
  );
}
