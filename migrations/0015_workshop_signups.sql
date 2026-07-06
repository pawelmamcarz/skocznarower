-- Zapisy na warsztaty dirt/slopestyle dla młodzieży (landing /warsztaty).
-- Publiczny formularz POST /api/warsztaty wstawia tu wiersz; właściciel dostaje
-- o każdym zapisie SMS i mail (fail-soft, jak przy nowej rezerwacji serwisu).
-- Na razie brak widoku w /admin; zgłoszenia przegląda się zapytaniem do D1.
CREATE TABLE IF NOT EXISTS workshop_signups (
  id          TEXT PRIMARY KEY,
  parent_name TEXT NOT NULL,
  phone       TEXT NOT NULL,
  email       TEXT,
  child_age   INTEGER NOT NULL,
  level       TEXT NOT NULL DEFAULT 'nie-wiem',   -- start | progress | air | nie-wiem
  location    TEXT NOT NULL DEFAULT 'obojetnie',  -- grodzisk | milanowek | obojetnie
  notes       TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workshop_signups_phone ON workshop_signups(phone);
CREATE INDEX IF NOT EXISTS idx_workshop_signups_created ON workshop_signups(created_at);
