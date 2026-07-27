-- Zgody, wypis z przypomnien, niezawodna kolejka komunikacji i audyt operacji.

ALTER TABLE seasonal_reminders ADD COLUMN consent_at INTEGER;
ALTER TABLE seasonal_reminders ADD COLUMN consent_version TEXT;
ALTER TABLE seasonal_reminders ADD COLUMN unsubscribe_token TEXT;
ALTER TABLE seasonal_reminders ADD COLUMN unsubscribed_at INTEGER;
ALTER TABLE seasonal_reminders ADD COLUMN last_sent_year INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_seasonal_unsubscribe_token
  ON seasonal_reminders(unsubscribe_token) WHERE unsubscribe_token IS NOT NULL;

ALTER TABLE workshop_signups ADD COLUMN consent_at INTEGER;
ALTER TABLE workshop_signups ADD COLUMN consent_version TEXT;

-- Archiwizacja zachowuje historie zlecenia zamiast bezpowrotnego DELETE.
ALTER TABLE bookings ADD COLUMN archived_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_bookings_archived ON bookings(archived_at);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id                  TEXT PRIMARY KEY,
  entity_type         TEXT NOT NULL,
  entity_id           TEXT NOT NULL,
  event_key           TEXT NOT NULL,
  channel             TEXT NOT NULL,
  recipient           TEXT NOT NULL,
  body                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  next_attempt_at     INTEGER NOT NULL,
  last_error          TEXT,
  provider_message_id TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  sent_at             INTEGER,
  UNIQUE(entity_type, entity_id, event_key, channel)
);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_due
  ON notification_outbox(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id            TEXT PRIMARY KEY,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  action        TEXT NOT NULL,
  metadata_json TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity
  ON audit_events(entity_type, entity_id, created_at DESC);

-- Ogranicznik publicznych POST-ow przechowuje tylko HMAC adresu IP i krotkie okna.
CREATE TABLE IF NOT EXISTS request_rate_limits (
  key_hash     TEXT NOT NULL,
  endpoint     TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 1,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (key_hash, endpoint, window_start)
);
CREATE INDEX IF NOT EXISTS idx_request_rate_limits_updated
  ON request_rate_limits(updated_at);
