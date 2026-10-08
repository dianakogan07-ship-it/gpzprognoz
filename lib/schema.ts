// Схема БД (дублирует db/schema.sql для автосоздания таблиц на Vercel)
export const SCHEMA_SQL = `
-- Справочники сервиса прогнозирования цен ГПЗ
CREATE TABLE IF NOT EXISTS sources (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  kind TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT TRUE,
  note TEXT
);
CREATE TABLE IF NOT EXISTS categories (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS purchase_types (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS purchase_forms (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS purchase_methods (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS regions (code TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS okei (code TEXT PRIMARY KEY, name TEXT NOT NULL, short TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS okved2 (letter TEXT PRIMARY KEY, name TEXT NOT NULL, div_from INT NOT NULL, div_to INT NOT NULL);
CREATE TABLE IF NOT EXISTS okpd2 (code TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ws_codes (
  code TEXT PRIMARY KEY,
  name TEXT,
  category TEXT,
  auto_added BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS repeat_rules (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('okpd2', 'ws')),
  prefix TEXT NOT NULL,
  repeatable BOOLEAN NOT NULL,
  note TEXT,
  UNIQUE (kind, prefix)
);
CREATE TABLE IF NOT EXISTS price_indices (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('to_december', 'forecast', 'cpi')),
  key TEXT,
  year INT NOT NULL,
  month INT CHECK (month BETWEEN 1 AND 12),
  value NUMERIC(8, 5) NOT NULL CHECK (value > 0),
  source_code TEXT REFERENCES sources(code) ON UPDATE CASCADE,
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  note TEXT
);
`;

/** Изменения схемы для уже созданных баз: выполняются при каждом запуске, повторно безопасны */
export const MIGRATIONS_SQL = `
-- Версии индексов и сведения об источнике (загрузка прогноза МЭР)
ALTER TABLE price_indices ADD COLUMN IF NOT EXISTS raw_line TEXT;
ALTER TABLE price_indices ADD COLUMN IF NOT EXISTS doc_title TEXT;
ALTER TABLE price_indices ADD COLUMN IF NOT EXISTS doc_date TEXT;
ALTER TABLE price_indices ADD COLUMN IF NOT EXISTS doc_page TEXT;
ALTER TABLE price_indices ADD COLUMN IF NOT EXISTS indicator TEXT;
ALTER TABLE price_indices ADD COLUMN IF NOT EXISTS ref_deflator NUMERIC(8, 5);
ALTER TABLE price_indices ADD COLUMN IF NOT EXISTS pending_of INT REFERENCES price_indices(id) ON DELETE CASCADE;
ALTER TABLE price_indices ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;
ALTER TABLE price_indices ADD COLUMN IF NOT EXISTS change_note TEXT;
ALTER TABLE price_indices ADD COLUMN IF NOT EXISTS loaded_at TIMESTAMPTZ DEFAULT now();
DROP INDEX IF EXISTS price_indices_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS price_indices_active_uniq ON price_indices (kind, COALESCE(key, ''), year, COALESCE(month, 0)) WHERE pending_of IS NULL AND superseded_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS price_indices_pending_uniq ON price_indices (pending_of) WHERE pending_of IS NOT NULL;
-- Сохранённые прогнозы, версии, строки, журнал изменений, факт
CREATE TABLE IF NOT EXISTS forecasts (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  year INT NOT NULL,
  base_year INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'rejected', 'archived')),
  current_version_id INT,
  author TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS forecast_versions (
  id SERIAL PRIMARY KEY,
  forecast_id INT NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE,
  number INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'rejected', 'archived')),
  comment TEXT,
  index_snapshot JSONB NOT NULL DEFAULT '[]',
  index_fingerprint TEXT,
  stats JSONB NOT NULL DEFAULT '{}',
  author TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (forecast_id, number)
);
CREATE TABLE IF NOT EXISTS forecast_items (
  id SERIAL PRIMARY KEY,
  version_id INT NOT NULL REFERENCES forecast_versions(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  okpd2 TEXT NOT NULL,
  subject TEXT NOT NULL,
  category TEXT,
  method TEXT,
  region TEXT,
  unit TEXT NOT NULL,
  contracts INT NOT NULL DEFAULT 0,
  base_price NUMERIC(18, 2) NOT NULL,
  index_value NUMERIC(8, 5) NOT NULL,
  index_source TEXT,
  forecast_price NUMERIC(18, 2) NOT NULL,
  needs_review BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  manually_edited BOOLEAN NOT NULL DEFAULT FALSE,
  data JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS forecast_items_version ON forecast_items (version_id, okpd2);
CREATE TABLE IF NOT EXISTS change_log (
  id SERIAL PRIMARY KEY,
  forecast_id INT NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE,
  version_id INT REFERENCES forecast_versions(id) ON DELETE CASCADE,
  item_id INT REFERENCES forecast_items(id) ON DELETE SET NULL,
  okpd2 TEXT,
  event_type TEXT NOT NULL,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  author TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS change_log_forecast ON change_log (forecast_id, created_at DESC);
CREATE TABLE IF NOT EXISTS actuals (
  id SERIAL PRIMARY KEY,
  forecast_id INT NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  okpd2 TEXT NOT NULL,
  subject TEXT,
  category TEXT,
  actual_price NUMERIC(18, 2) NOT NULL,
  contracts INT NOT NULL DEFAULT 0,
  author TEXT NOT NULL DEFAULT 'owner',
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS actuals_forecast ON actuals (forecast_id, item_key);
-- Цвет карточки, выбранный пользователем (пусто — по статусу)
ALTER TABLE forecasts ADD COLUMN IF NOT EXISTS color TEXT;
-- Короткие названия категорий для графиков отчёта
ALTER TABLE categories ADD COLUMN IF NOT EXISTS short_name TEXT;
UPDATE categories SET short_name = 'ИТ-лицензии' WHERE name = 'ИТ-Лицензии' AND short_name IS NULL;
UPDATE categories SET short_name = 'Строительство' WHERE name = 'Капитальное строительство и ПИР' AND short_name IS NULL;
UPDATE categories SET short_name = 'МТР' WHERE name = 'МТР' AND short_name IS NULL;
UPDATE categories SET short_name = 'Произв. услуги' WHERE name = 'Производственные работы/услуги' AND short_name IS NULL;
UPDATE categories SET short_name = 'Сырьё' WHERE name = 'Сырьё (нефть, нефтепродукты, нефтехимия, газ)' AND short_name IS NULL;
UPDATE categories SET short_name = 'Товары АХН' WHERE name = 'Товары административно-хозяйственного назначения' AND short_name IS NULL;
UPDATE categories SET short_name = 'Общие услуги' WHERE name = 'Услуги/работы общего профиля' AND short_name IS NULL;
-- Статус «Отклонён»
ALTER TABLE forecasts DROP CONSTRAINT IF EXISTS forecasts_status_check;
ALTER TABLE forecasts ADD CONSTRAINT forecasts_status_check CHECK (status IN ('draft', 'review', 'approved', 'rejected', 'archived'));
ALTER TABLE forecast_versions DROP CONSTRAINT IF EXISTS forecast_versions_status_check;
ALTER TABLE forecast_versions ADD CONSTRAINT forecast_versions_status_check CHECK (status IN ('draft', 'review', 'approved', 'rejected', 'archived'));
-- Строки файлов, не вошедшие в расчёт версии
ALTER TABLE forecast_versions ADD COLUMN IF NOT EXISTS excluded_rows JSONB NOT NULL DEFAULT '[]'
`;
