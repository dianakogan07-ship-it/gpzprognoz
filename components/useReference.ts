"use client";
import { useCallback, useEffect, useState } from "react";
import type { Reference } from "@/lib/types";

export function useReference() {
  const [data, setData] = useState<{ db: boolean; reference: Reference } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const r = await fetch("/api/reference");
    const j = await r.json();
    if (!r.ok) setError(j.error); else setData(j);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { ...data, error, reload };
}

export async function api(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j;
}
