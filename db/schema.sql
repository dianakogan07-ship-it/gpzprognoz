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
