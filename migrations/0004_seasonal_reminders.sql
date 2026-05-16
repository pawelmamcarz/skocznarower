-- Lista e-maili zapisanych na przypomnienie sezonowe ("Przypomnij mi o przeglądzie wiosennym").
-- Cron Worker 15 marca każdego roku wysyła do nich maila zachęcającego do umówienia wizyty.
CREATE TABLE IF NOT EXISTS seasonal_reminders (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  signed_up_at INTEGER NOT NULL,
  sent_at      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_seasonal_email ON seasonal_reminders(email);
CREATE INDEX IF NOT EXISTS idx_seasonal_sent ON seasonal_reminders(sent_at);
