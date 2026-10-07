"use client";
import { useState } from "react";
import { Modal } from "./Modal";

/** Окно с одним обязательным текстовым полем: комментарий к версии, причина правки */
export function PromptModal({ title, subtitle, label, placeholder, action, onSubmit, onClose }: {
  title: string; subtitle?: string; label: string; placeholder?: string; action: string;
  onSubmit: (text: string) => Promise<void>; onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (!text.trim()) return setError("Поле обязательно");
    setBusy(true); setError(null);
    try { await onSubmit(text.trim()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose}
      footer={<><button className="btn-sec" onClick={onClose}>Отмена</button><button className="btn" disabled={busy} onClick={submit}>{busy ? "Сохранение…" : action}</button></>}>
      <div><label className="field-label" htmlFor="prompt">{label}</label>
        <textarea id="prompt" autoFocus rows={3} className="inp py-2" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} /></div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Modal>
  );
}
