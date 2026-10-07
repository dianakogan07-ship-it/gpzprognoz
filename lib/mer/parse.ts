import { cleanText, type Cell, type Page, type Row } from "./grid";

/** Строка предпросмотра: один вид деятельности (или ИПЦ) */
export interface MerRow {
  id: string;
  kind: "forecast" | "cpi";
  /** Коды для индекса: «05», «06», «B». Несколько — если в документе «06+09» или «10-12» */
  keys: string[];
  /** Код как в документе: «Раздел B», «05», «06+09» */
  codeText: string;
  /** Основной показатель: ИЦП, если он есть, иначе дефлятор */
  indicator: "icp" | "deflator" | null;
  /** Коэффициент на целевой год: 1.045 = +4,5 % */
  value: number | null;
  /** Дефлятор справочно, если основным взят ИЦП */
  deflator: number | null;
  /** Исходные строки документа */
  raw: string;
  page: string;
  /** Почему строку нельзя сохранить без правки */
  problems: string[];
}

export interface MerParseResult {
  title: string | null;
  approvedDate: string | null;
  targetYear: number;
  tablePage: string | null;
  rows: MerRow[];
  warnings: string[];
}

const NUM = /^[-−–]?\d{1,4}(?:[.,]\d+)?$/;
const isNum = (s: string) => NUM.test(s.replace(/\s/g, ""));
const toNum = (s: string) => Number(s.replace(/\s/g, "").replace(/[−–]/, "-").replace(",", "."));
const rowText = (r: Row) => r.cells.map((c) => c.text).join(" ");

/** Латинские буквы разделов ОКВЭД2, набранные кириллицей */
const LOOKALIKE: Record<string, string> = { А: "A", В: "B", С: "C", Е: "E", Н: "H", К: "K", М: "M", О: "O", Р: "P", Т: "T", Х: "X" };
const latin = (ch: string) => LOOKALIKE[ch.toUpperCase()] ?? ch.toUpperCase();

/** Код вида деятельности из подписи строки: «Раздел B», «(05)», «(06+09)», «(10-12)» */
export function parseGroup(label: string): { keys: string[]; codeText: string } | null {
  const sec = label.match(/раздел\S*\s+([A-UА-Я])(?![А-Яа-яA-Za-z])/i);
  const paren = [...label.matchAll(/\(([^()]*)\)/g)].map((m) => m[1].trim());
  for (const p of paren) {
    const inner = p.replace(/^(код\S*|окв[эе]д\s*2?)\s*/i, "");
    if (/^\d{2}(\s*[+,;\-–]\s*\d{2})*$/.test(inner)) return { keys: expandCodes(inner), codeText: inner.replace(/\s+/g, "") };
    const s = inner.match(/^(?:раздел\S*\s+)?([A-UА-Я])$/i);
    if (s) return { keys: [latin(s[1])], codeText: `Раздел ${latin(s[1])}` };
  }
  if (sec) return { keys: [latin(sec[1])], codeText: `Раздел ${latin(sec[1])}` };
  return null;
}

export function expandCodes(s: string): string[] {
  const out: string[] = [];
  for (const part of s.split(/\s*[+,;]\s*/)) {
    const range = part.match(/^(\d{2})\s*[-–]\s*(\d{2})$/);
    if (range) for (let c = +range[1]; c <= +range[2]; c++) out.push(String(c).padStart(2, "0"));
    else if (/^\d{2}$/.test(part)) out.push(part);
  }
  return [...new Set(out)];
}

export function indicatorOf(label: string): "icp" | "deflator" | null {
  if (/дефлятор/i.test(label)) return "deflator";
  if (/цен\S*\s+производител|(^|[^а-яё])ицп($|[^а-яё])/i.test(label)) return "icp";
  return null;
}

const YEAR = (y: number) => new RegExp(`^${y}(\\s*(г\\.?|год\\S*))?$`, "i");

interface Columns { x: number; tolerance: number; firstX: number }

/** Колонка целевого года в заголовке страницы (базовый вариант, если вариантов несколько) */
function findColumn(rows: Row[], from: number, to: number, year: number, tolDefault: number): Columns | null {
  let tol = tolDefault;
  const years: Cell[] = [], bases: Cell[] = [];
  let firstX = Infinity;
  for (let i = from; i < to; i++) {
    for (const c of rows[i].cells) {
      if (YEAR(year).test(c.text)) years.push(c);
      if (/^20\d\d/.test(c.text)) firstX = Math.min(firstX, c.x);
      if (/базов/i.test(c.text)) bases.push(c);
    }
  }
  if (!years.length) return null;
  // Допуск — половина расстояния между соседними колонками заголовка
  const xs = [...new Set(rows.slice(from, to).flatMap((r) => r.cells.filter((c) => /^20\d\d|базов|консерв|отч[её]т|оценк|прогноз/i.test(c.text)).map((c) => Math.round(c.x * 10) / 10)))].sort((a, b) => a - b);
  const gaps = xs.slice(1).map((x, i) => x - xs[i]).filter((g) => g > 0.5);
  if (gaps.length) tol = Math.max(Math.min(...gaps) * 0.55, 0.4);
  const yearX = years[0].x;
  // Год над подколонками вариантов — берём ближайшую подколонку «базовый»
  const near = bases.filter((b) => Math.abs(b.x - yearX) < tol * 6).sort((a, b) => Math.abs(a.x - yearX) - Math.abs(b.x - yearX));
  return { x: near.length ? near[0].x : yearX, tolerance: tol, firstX };
}

/** Значение в колонке целевого года */
function valueAt(r: Row, col: Columns): string | null {
  let best: Cell | null = null;
  for (const c of r.cells) {
    if (!isNum(c.text)) continue;
    if (Math.abs(c.x - col.x) <= col.tolerance && (!best || Math.abs(c.x - col.x) < Math.abs(best.x - col.x))) best = c;
  }
  return best?.text ?? null;
}

const labelOf = (r: Row, col: Columns) => cleanText(r.cells.filter((c) => !isNum(c.text) && c.x < col.firstX - col.tolerance).map((c) => c.text).join(" "));
const hasNumbers = (r: Row, col: Columns) => r.cells.some((c) => isNum(c.text) && c.x >= col.firstX - col.tolerance);

const hasAnyNumber = (r: Row) => r.cells.some((c) => isNum(c.text) && !/^20\d\d$/.test(c.text));
/** Подпись без слов о виде показателя: «Строительство — дефлятор» → «Строительство» */
const ownLabel = (s: string) => s.replace(/индекс\S*[-\s]*дефлятор\S*|дефлятор\S*|индекс\S*\s+цен\S*\s+производител\S*|(^|[^а-яё])ицп(?=$|[^а-яё])|%|г\/г/gi, "").replace(/[—–\-,;:()\s]+/g, " ").trim();
const TABLE_TITLE = (t: string) => /цен\S*\s+производител/i.test(t) && /дефлятор/i.test(t);
const OTHER_TITLE = (t: string) => /^(таблица|приложение|прогноз|основные|\d+\.\s)/i.test(t) && t.length > 25 && !TABLE_TITLE(t);

export function toCoef(text: string): { value: number | null; problem?: string } {
  const v = toNum(text);
  if (!Number.isFinite(v)) return { value: null, problem: "значение не распознано" };
  if (v >= 50 && v <= 300) return { value: Math.round(v * 1000) / 100000 };
  return { value: null, problem: `значение «${text}» не похоже на индекс в % к предыдущему году` };
}

/** Разбор документа МЭР: таблица ИЦП и дефляторов по видам деятельности + ИПЦ */
export function parseMer(pages: Page[], targetYear: number): MerParseResult {
  const warnings: string[] = [];
  const all = pages.flatMap((p, pi) => p.rows.map((r, ri) => ({ r, pi, ri })));
  const docText = all.slice(0, 400).map((x) => rowText(x.r)).join("\n");

  const head = cleanText(all.slice(0, 120).map((x) => rowText(x.r)).join(" "));
  const tm = head.match(/прогноз\S*\s+социально-экономического\s+развития[^.]{0,160}?плановый\s+период[^.]{0,30}?годов/i)
    ?? head.match(/прогноз\S*\s+социально-экономического\s+развития[^.]{0,160}?год\S*/i);
  const title = tm ? cleanText(tm[0]).replace(/^прогноз\S*/i, "Прогноз") : null;
  const date = docText.match(/одобрен\S*[\s\S]{0,200}?(\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+\d{4}|\d{2}\.\d{2}\.\d{4})/i);

  // ---- Таблица ИЦП и дефляторов ----
  const rows: MerRow[] = [];
  let tablePage: string | null = null;
  const start = all.findIndex((x, i) => /цен\S*\s+производител|дефлятор/i.test(rowText(x.r)) && !hasAnyNumber(x.r)
    && TABLE_TITLE(rowText(x.r) + " " + (all[i + 1]?.pi === x.pi ? rowText(all[i + 1].r) : "")));
  if (start < 0) warnings.push("Не найдена таблица «Прогноз индексов цен производителей и индексов-дефляторов по видам экономической деятельности»");
  else {
    tablePage = pages[all[start].pi].label;
    if (!/базов/i.test(all.slice(start, start + 15).map((x) => rowText(x.r)).join(" ")) && !/базов/i.test(rowText(all[start].r))) {
      warnings.push("В заголовке таблицы не указан вариант прогноза — проверьте, что это базовый вариант");
    }
    type Raw = { keys: string[]; codeText: string; indicator: "icp" | "deflator" | null; value: string | null; raw: string; page: string; groupLabel: string };
    const found: Raw[] = [];
    let group: { keys: string[]; codeText: string; label: string } | null = null;
    let pendingLabel = "";
    let seenData = false;
    for (let pi = all[start].pi; pi < pages.length; pi++) {
      const page = pages[pi];
      const rs = page.rows;
      const from = pi === all[start].pi ? all[start].ri : 0;
      // Заголовок с годами — в первых строках таблицы на каждой странице
      let headerEnd = from;
      while (headerEnd < rs.length && !rs[headerEnd].cells.some((c) => YEAR(targetYear).test(c.text)) && headerEnd - from < 25) headerEnd++;
      const col = findColumn(rs, from, Math.min(rs.length, headerEnd + 4), targetYear, page.tolerance ?? 14);
      if (!col) {
        if (seenData) break;
        if (pi === all[start].pi) warnings.push(`В таблице нет колонки ${targetYear} года`);
        continue;
      }
      let stop = false;
      for (let i = headerEnd + 1; i < rs.length; i++) {
        const r = rs[i];
        const text = rowText(r);
        if (seenData && OTHER_TITLE(text) && !hasNumbers(r, col)) { stop = true; break; }
        if (r.cells.some((c) => /^20\d\d/.test(c.text) || /базов|консерв/i.test(c.text)) && !hasNumbers(r, col)) continue;
        const label = labelOf(r, col);
        const g = parseGroup(label);
        if (!hasNumbers(r, col)) {
          if (g) { group = { ...g, label }; pendingLabel = ""; }
          else if (label) pendingLabel = cleanText(`${pendingLabel} ${label}`);
          continue;
        }
        seenData = true;
        const full = cleanText(`${pendingLabel} ${label}`);
        const wrapped = pendingLabel;
        pendingLabel = "";
        const gg = parseGroup(full);
        const ind = indicatorOf(full);
        if (gg) group = { ...gg, label: full };
        const value = valueAt(r, col);
        // Строка без кода и без указания показателя — новая группа без кода (например, «Всего»)
        const own = ownLabel(full).length > 3;
        const useGroup = gg ? { ...gg, label: full } : !own && group ? group : null;
        if (!gg && own) group = null;
        found.push({
          keys: useGroup?.keys ?? [], codeText: useGroup?.codeText ?? "", indicator: ind, value,
          raw: cleanText(`${useGroup && !gg ? `${useGroup.label} → ` : ""}${wrapped} ${text}`), page: page.label, groupLabel: useGroup?.label ?? full,
        });
      }
      if (stop) break;
    }
    // Объединение ИЦП и дефлятора одного вида деятельности
    const byGroup = new Map<string, Raw[]>();
    found.forEach((f, i) => {
      const k = f.keys.length ? f.codeText : `?${i}`;
      byGroup.set(k, [...(byGroup.get(k) ?? []), f]);
    });
    let n = 0;
    for (const items of byGroup.values()) {
      const icp = items.find((x) => x.indicator === "icp");
      const defl = items.find((x) => x.indicator === "deflator");
      const main = icp ?? defl ?? items[0];
      const problems: string[] = [];
      if (!main.keys.length) problems.push("не определён код ОКВЭД2");
      if (!main.indicator) problems.push("не определено, ИЦП это или дефлятор");
      if (items.filter((x) => x.indicator === main.indicator).length > 1) problems.push("в документе несколько значений для этого вида — выберите нужное");
      const v = main.value == null ? { value: null, problem: `нет значения за ${targetYear} год` } : toCoef(main.value);
      if (v.problem) problems.push(v.problem);
      const d = icp && defl?.value ? toCoef(defl.value).value : null;
      rows.push({
        id: `f${n++}`, kind: "forecast", keys: main.keys, codeText: main.codeText, indicator: main.indicator,
        value: v.value, deflator: d, raw: items.map((x) => x.raw).join("\n"), page: main.page, problems,
      });
    }
    if (!rows.length && start >= 0) warnings.push("Таблица найдена, но строки с кодами ОКВЭД2 не распознаны");
  }

  // ---- ИПЦ ----
  const cpi = findCpi(pages, targetYear);
  if (cpi) rows.push(cpi);
  else warnings.push(`Не найден индекс потребительских цен на ${targetYear} год`);

  return { title, approvedDate: date ? date[1] : null, targetYear, tablePage, rows, warnings };
}

/** ИПЦ: предпочтительно «в среднем за год», иначе «на конец года» */
function findCpi(pages: Page[], year: number): MerRow | null {
  const cands: { avg: boolean; row: MerRow }[] = [];
  for (const page of pages) {
    const rs = page.rows;
    let heading = "";
    for (let i = 0; i < rs.length; i++) {
      const text = rowText(rs[i]);
      // Ближайший заголовок с годами выше строки
      let h = i;
      while (h >= 0 && !rs[h].cells.some((c) => YEAR(year).test(c.text))) h--;
      if (h < 0) continue;
      const col = findColumn(rs, Math.max(0, h - 3), h + 3, year, page.tolerance ?? 14);
      if (!col) continue;
      const label = labelOf(rs[i], col);
      if (!hasNumbers(rs[i], col)) { if (label) heading = label; continue; }
      const isCpi = /потребительск\S*\s+цен|(^|[^а-яё])ипц($|[^а-яё])/i.test(label) || (/потребительск\S*\s+цен|(^|[^а-яё])ипц($|[^а-яё])/i.test(heading) && /(в среднем|на конец|декабр)/i.test(label));
      if (!isCpi) { if (label) heading = ""; continue; }
      const v = valueAt(rs[i], col);
      if (!v) continue;
      const c = toCoef(v);
      const avg = /в среднем/i.test(label);
      const problems = c.problem ? [c.problem] : [];
      if (!avg && !/на конец|декабр/i.test(label)) problems.push("не указано, среднегодовой это ИПЦ или на конец года");
      cands.push({ avg, row: {
        id: `cpi${cands.length}`, kind: "cpi", keys: [], codeText: "", indicator: null, value: c.value, deflator: null,
        raw: cleanText(`${heading && !/потребительск/i.test(label) ? `${heading} → ` : ""}${text}`), page: page.label, problems,
      } });
    }
  }
  return (cands.find((c) => c.avg && !c.row.problems.length) ?? cands.find((c) => !c.row.problems.length) ?? cands[0])?.row ?? null;
}

/** Коды из поля ввода: «06+09», «10-12», «B», «43.2» */
export function parseCodeInput(s: string): string[] {
  const t = s.trim().toUpperCase().replace(/^РАЗДЕЛ\s*/, "");
  if (!t) return [];
  if (/^[A-UА-Я]$/.test(t)) return /^[A-U]$/.test(latin(t)) ? [latin(t)] : [];
  if (/^\d{2}(\.\d+)*$/.test(t)) return [t];
  const codes = expandCodes(t);
  return codes.length && t.replace(/\s/g, "").split(/[+,;]/).every((p) => /^\d{2}([-–]\d{2})?$/.test(p)) ? codes : [];
}
