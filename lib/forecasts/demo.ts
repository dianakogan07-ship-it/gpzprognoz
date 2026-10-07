import { loadReference, sql } from "../db";
import { aggregateForecast, type ContractPoint } from "../forecast";
import type { PriceIndex, Reference } from "../types";
import { appendItems, createForecast, editItem, finalizeUpload, getItems, newVersion, saveActuals, setStatus } from "./store";

/** Детерминированный генератор, чтобы примеры были одинаковыми */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const GOODS: [string, string, string, number][] = [
  ["17.23.13", "Товары административно-хозяйственного назначения", "шт", 350],
  ["20.41.32", "Товары административно-хозяйственного назначения", "шт", 210],
  ["26.20.11", "МТР", "шт", 78000],
  ["28.13.14", "МТР", "шт", 420000],
  ["43.21.10", "Капитальное строительство и ПИР", "усл. ед", 1250000],
  ["58.29.29", "ИТ-Лицензии", "шт", 56000],
  ["61.10.11", "Услуги/работы общего профиля", "мес", 38000],
  ["68.20.12", "Услуги/работы общего профиля", "мес", 410000],
  ["80.10.12", "Услуги/работы общего профиля", "мес", 260000],
  ["81.21.10", "Услуги/работы общего профиля", "мес", 145000],
  ["19.20.21", "Сырьё (нефть, нефтепродукты, нефтехимия, газ)", "т", 61000],
  ["33.12.19", "Производственные работы/услуги", "усл. ед", 330000],
];
const METHODS = ["Конкурентный отбор", "Аукцион", "Запрос предложений", "Закупка у единственного поставщика"];
const REGIONS = ["40", "45", "71100", "41"];

function points(seed: number, goods: typeof GOODS): ContractPoint[] {
  const r = rng(seed);
  const out: ContractPoint[] = [];
  for (const [okpd2, category, unit, price] of goods) {
    for (const region of REGIONS.slice(0, 1 + Math.floor(r() * 3))) {
      const n = 1 + Math.floor(r() * 6);
      for (let k = 0; k < n; k++) {
        out.push({ okpd2, unit, region, ws: null, category, method: METHODS[Math.floor(r() * METHODS.length)], subject: "", raw: Math.round(price * (0.8 + r() * 0.4) * 100) / 100, month: 1 + Math.floor(r() * 12) });
      }
    }
  }
  return out;
}

const demoIndex = (id: number, kind: PriceIndex["kind"], key: string | null, year: number, value: number): PriceIndex =>
  ({ id: -id, kind, key, year, month: null, value, source_code: "MER_FORECAST", approved: true, note: "пример" });

async function make(ref: Reference, p: { title: string; year: number; baseYear: number; seed: number; goods: typeof GOODS }) {
  const { id, versionId } = await createForecast({ title: p.title, year: p.year, baseYear: p.baseYear, author: "пример" }, ref);
  const rows = aggregateForecast(points(p.seed, p.goods), ref, { baseYear: p.baseYear, targetYear: p.year });
  await appendItems(id, versionId, rows);
  await finalizeUpload(id, versionId, { gpzRows: rows.reduce((s, r) => s + r.contracts, 0) + 7, excluded: 7, author: "пример" });
  return { id, versionId, rows };
}

/** Примеры прогнозов разных лет и статусов — создаются один раз в пустой базе */
export async function seedDemo() {
  const [{ n }] = await sql().query("SELECT count(*) AS n FROM forecasts");
  if (Number(n) > 0) return;
  const base = await loadReference();
  const withPast: Reference = {
    ...base,
    indices: [...base.indices, demoIndex(1, "forecast", "C", 2026, 1.071), demoIndex(2, "forecast", "F", 2026, 1.094),
      demoIndex(3, "forecast", "N", 2026, 1.083), demoIndex(4, "cpi", null, 2026, 1.079),
      demoIndex(5, "forecast", "C", 2025, 1.092), demoIndex(6, "cpi", null, 2025, 1.085)],
  };

  // Утверждённый прогноз прошлого года с фактом
  const a = await make(withPast, { title: "Прогноз 2026 (пример)", year: 2026, baseYear: 2025, seed: 7, goods: GOODS });
  const items = await getItems(a.versionId);
  const flagged = items.find((i) => i.needs_review) ?? items[0];
  await editItem(a.id, flagged.id, "forecast_price", Math.round(flagged.forecast_price * 1.05), "Уточнено по коммерческим предложениям", "пример");
  for (const i of items.filter((x) => x.needs_review)) await editItem(a.id, i.id, "reviewed", true, "Проверено", "пример");
  await setStatus(a.id, "review", "пример");
  await setStatus(a.id, "approved", "пример");
  const r = rng(99);
  await saveActuals(a.id, items.map((i) => ({
    item_key: i.item_key, okpd2: i.okpd2, subject: i.subject, category: i.category, contracts: i.contracts,
    actual_price: Math.round(i.forecast_price * (0.9 + r() * 0.2) * 100) / 100,
  })), "пример");

  // Прогноз на следующий год на проверке
  const b = await make(base, { title: "Прогноз 2027 — основной (пример)", year: 2027, baseYear: 2026, seed: 11, goods: GOODS });
  const bItems = (await getItems(b.versionId)).filter((i) => i.needs_review);
  for (const i of bItems.slice(0, Math.ceil(bItems.length * 0.6))) await editItem(b.id, i.id, "reviewed", true, "Проверено", "пример");
  const v2 = await newVersion(b.id, "Уточнены цены по аренде", "пример");
  const rent = (await getItems(v2.versionId)).find((i) => i.okpd2.startsWith("68"));
  if (rent) await editItem(b.id, rent.id, "forecast_price", Math.round(rent.forecast_price * 0.97), "Арендодатель зафиксировал ставку на год", "пример");
  await setStatus(b.id, "review", "пример");

  // Черновик, посчитанный до загрузки прогноза инфляции, — увидит «Новые индексы»
  await make({ ...base, indices: base.indices.filter((i) => i.kind !== "cpi") }, { title: "Прогноз 2027 — ИТ и связь (пример)", year: 2027, baseYear: 2026, seed: 23, goods: GOODS.filter((g) => /^(26|58|61|62|63)/.test(g[0])) });

  // Старый прогноз в архиве
  const d = await make(withPast, { title: "Прогноз 2025 (пример)", year: 2025, baseYear: 2024, seed: 3, goods: GOODS.slice(0, 6) });
  await setStatus(d.id, "review", "пример");
  await setStatus(d.id, "approved", "пример");
  await setStatus(d.id, "archived", "пример");
}
