-- Gra Skoczna Rider: gracze potwierdzeni SMS-em, kody weryfikacyjne i wyniki.
-- Numer telefonu trzymamy w formacie 48XXXXXXXXX (waPhoneKey), zgody osobno:
-- consent_data jest wymagana do rankingu, consent_marketing jest dobrowolna.

CREATE TABLE IF NOT EXISTS game_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_key TEXT NOT NULL UNIQUE,
  nick TEXT NOT NULL,
  verified_at INTEGER,
  consent_data INTEGER NOT NULL DEFAULT 0,
  consent_marketing INTEGER NOT NULL DEFAULT 0,
  consent_version TEXT,
  source TEXT,
  runs INTEGER NOT NULL DEFAULT 0,
  best_score INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_game_players_created ON game_players(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_players_marketing ON game_players(consent_marketing, created_at DESC);

CREATE TABLE IF NOT EXISTS game_verifications (
  phone_key TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  nick TEXT,
  consent_marketing INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL,
  last_sent_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS game_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES game_players(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  score INTEGER NOT NULL,
  dist INTEGER NOT NULL DEFAULT 0,
  coins INTEGER NOT NULL DEFAULT 0,
  flips INTEGER NOT NULL DEFAULT 0,
  bike TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_game_scores_level ON game_scores(level, score DESC);
CREATE INDEX IF NOT EXISTS idx_game_scores_player ON game_scores(player_id, created_at DESC);
