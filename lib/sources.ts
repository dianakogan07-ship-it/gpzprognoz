import type { IndexKind } from "./types";

/** Где взять данные для индексов: ссылки на сайты-источники по вкладкам раздела «Индексы» */
export interface DataLink {
  title: string;
  description: string;
  url: string;
  /** Коды источников в справочнике — по ним показывается дата последней загрузки */
  sourceCodes: string[];
}

export const DATA_LINKS: Record<IndexKind, DataLink[]> = {
  forecast: [
    {
      title: "Минэкономразвития, прогнозы социально-экономического развития",
      description: "Основной источник: таблица «Прогноз индексов цен производителей и индексов-дефляторов по видам экономической деятельности», базовый вариант, и ИПЦ",
      url: "https://www.economy.gov.ru/material/directions/makroec/prognozy_socialno_ekonomicheskogo_razvitiya/",
      sourceCodes: ["MER_FORECAST"],
    },
    {
      title: "Банк России, денежно-кредитная политика",
      description: "Прогноз инфляции, для сверки ИПЦ",
      url: "https://www.cbr.ru/dkp/",
      sourceCodes: ["CBR"],
    },
  ],
  cpi: [],
  to_december: [
    {
      title: "Росстат, раздел «Цены»",
      description: "Индексы цен производителей",
      url: "https://rosstat.gov.ru/statistics/price",
      sourceCodes: ["ROSSTAT_ICP", "ROSSTAT_CPI"],
    },
    {
      title: "ЕМИСС",
      description: "Индексы цен производителей по ОКПД2, помесячно",
      url: "https://www.fedstat.ru/",
      sourceCodes: ["EMISS"],
    },
  ],
};
// Для общей инфляции — те же источники, что и для отраслевых индексов
DATA_LINKS.cpi = DATA_LINKS.forecast;

export const DATA_LINKS_HINT = "Скачайте файл с сайта и загрузите кнопкой ниже — сервис сам разберёт значения и отправит на проверку.";
