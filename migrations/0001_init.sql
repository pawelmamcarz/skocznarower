-- Rezerwacje wizyt serwisowych
CREATE TABLE IF NOT EXISTS bookings (
  id            TEXT PRIMARY KEY,
  created_at    INTEGER NOT NULL,
  date          TEXT NOT NULL,
  time_slot     TEXT NOT NULL,
  service_type  TEXT NOT NULL,
  bike_type     TEXT NOT NULL,
  customer_name  TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

-- Sloty zablokowane (urlop, święto, prywatne plany)
-- time_slot = 'all' blokuje cały dzień
CREATE TABLE IF NOT EXISTS blocked_slots (
  date       TEXT NOT NULL,
  time_slot  TEXT NOT NULL,
  reason     TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (date, time_slot)
);
