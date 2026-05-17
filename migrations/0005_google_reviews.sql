-- Cache opinii Google Business (Places API).
-- Worker odświeża dziennie (scheduled) + /admin/reviews-refresh ręcznie.
-- Bez ustawionych GOOGLE_PLACES_API_KEY i GOOGLE_PLACE_ID worker nic nie pobiera, a /api/reviews zwraca pustą listę.

CREATE TABLE IF NOT EXISTS google_reviews (
  review_id     TEXT PRIMARY KEY,
  author_name   TEXT NOT NULL,
  author_photo  TEXT,
  rating        INTEGER NOT NULL,
  text          TEXT NOT NULL,
  publish_time  INTEGER NOT NULL,
  language      TEXT,
  fetched_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_google_reviews_publish ON google_reviews(publish_time DESC);

-- Pojedynczy wiersz z metadanymi profilu (id='profile').
-- Trzymamy globalną średnią ocen i liczbę opinii do nagłówka sekcji.
CREATE TABLE IF NOT EXISTS google_profile (
  id            TEXT PRIMARY KEY,
  rating        REAL,
  review_count  INTEGER,
  fetched_at    INTEGER NOT NULL
);
