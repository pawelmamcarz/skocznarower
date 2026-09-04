-- Jednorazowy, podpisany bilet przejazdu wiąże wynik z graczem, trasą i rowerem.
CREATE TABLE game_runs (
  id TEXT PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES game_players(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  bike TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX idx_game_runs_expiry ON game_runs(expires_at);
ALTER TABLE game_scores ADD COLUMN run_id TEXT;
CREATE UNIQUE INDEX idx_game_scores_run ON game_scores(run_id) WHERE run_id IS NOT NULL;
