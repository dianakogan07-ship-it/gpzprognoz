export type IndexKind = "to_december" | "forecast" | "cpi";

export interface Source { id: number; code: string; name: string; url: string; kind: string; verified: boolean; note: string | null }
export interface Named { id: number; name: string }
export interface Region { code: string; name: string }
export interface Okei { code: string; name: string; short: string }
export interface Okved2Section { letter: string; name: string; div_from: number; div_to: number }
export interface Okpd2 { code: string; name: string }
export interface WsCode { code: string; name: string | null; category: string | null; auto_added: boolean }
export interface RepeatRule { id: number; kind: "okpd2" | "ws"; prefix: string; repeatable: boolean; note: string | null }
export interface PriceIndex {
  id: number;
  kind: IndexKind;
  /** Префикс ОКПД2 («43», «43.2») или буква раздела ОКВЭД2 («F»); пусто — для ИПЦ */
  key: string | null;
  year: number;
  /** Месяц заключения договора — только для to_december */
  month: number | null;
  /** Коэффициент: 1.12 = +12% */
  value: number;
  source_code: string | null;
  approved: boolean;
  note: string | null;
}

export interface Reference {
  sources: Source[];
  categories: Named[];
  purchaseTypes: Named[];
  purchaseForms: Named[];
  purchaseMethods: Named[];
  regions: Region[];
  okei: Okei[];
  okved2: Okved2Section[];
  okpd2: Okpd2[];
  ws: WsCode[];
  repeatRules: RepeatRule[];
  indices: PriceIndex[];
}
