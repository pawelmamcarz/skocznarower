-- CRM zapisow warsztatowych i wspolna atrybucja pozyskania.
-- Statusy, zrodla i jezyki sa walidowane whitelistami w Workerze. Pozostawienie
-- kolumn TEXT bez CHECK zachowuje zgodnosc ALTER TABLE z SQLite/D1.

ALTER TABLE workshop_signups ADD COLUMN status TEXT NOT NULL DEFAULT 'new';
ALTER TABLE workshop_signups ADD COLUMN source TEXT;
ALTER TABLE workshop_signups ADD COLUMN landing_path TEXT;
ALTER TABLE workshop_signups ADD COLUMN landing_language TEXT;
ALTER TABLE workshop_signups ADD COLUMN utm_source TEXT;
ALTER TABLE workshop_signups ADD COLUMN utm_medium TEXT;
ALTER TABLE workshop_signups ADD COLUMN utm_campaign TEXT;
ALTER TABLE workshop_signups ADD COLUMN utm_content TEXT;
ALTER TABLE workshop_signups ADD COLUMN utm_term TEXT;
ALTER TABLE workshop_signups ADD COLUMN referrer_host TEXT;

-- Terminy sa epoch ms; NULL oznacza, ze etap lub dalsza akcja nie sa ustawione.
ALTER TABLE workshop_signups ADD COLUMN trial_at INTEGER;
ALTER TABLE workshop_signups ADD COLUMN group_name TEXT;
ALTER TABLE workshop_signups ADD COLUMN next_action_at INTEGER;
ALTER TABLE workshop_signups ADD COLUMN lost_at INTEGER;
ALTER TABLE workshop_signups ADD COLUMN enrolled_at INTEGER;
ALTER TABLE workshop_signups ADD COLUMN assigned_to TEXT;
ALTER TABLE workshop_signups ADD COLUMN owner_notes TEXT;
ALTER TABLE workshop_signups ADD COLUMN updated_at INTEGER;

-- Obsluguje filtrowanie lejka po statusie i kolejke najblizszych kontaktow.
CREATE INDEX IF NOT EXISTS idx_workshop_signups_status_next_action
  ON workshop_signups(status, next_action_at);

-- Te same pola pozwalaja porownywac pozyskanie serwisu i warsztatow.
ALTER TABLE bookings ADD COLUMN source TEXT;
ALTER TABLE bookings ADD COLUMN landing_path TEXT;
ALTER TABLE bookings ADD COLUMN landing_language TEXT;
ALTER TABLE bookings ADD COLUMN utm_source TEXT;
ALTER TABLE bookings ADD COLUMN utm_medium TEXT;
ALTER TABLE bookings ADD COLUMN utm_campaign TEXT;
ALTER TABLE bookings ADD COLUMN utm_content TEXT;
ALTER TABLE bookings ADD COLUMN utm_term TEXT;
ALTER TABLE bookings ADD COLUMN referrer_host TEXT;
