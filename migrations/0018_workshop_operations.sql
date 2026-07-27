-- Operacyjna obsługa warsztatów: grupy, członkostwa, zajęcia, obecności i wpłaty.
-- Kwoty są przechowywane jako całkowita liczba groszy. Rekordy operacyjne zachowują
-- historię; panel nie udostępnia kasowania.

CREATE TABLE IF NOT EXISTS workshop_groups (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'paused', 'completed')),
  location         TEXT NOT NULL
                     CHECK (location IN ('grodzisk', 'milanowek', 'inne')),
  level            TEXT NOT NULL
                     CHECK (level IN ('start', 'progress', 'air', 'mixed')),
  weekday          INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time       TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 30 AND 300),
  capacity         INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 6),
  notes            TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workshop_groups_status
  ON workshop_groups(status, weekday, start_time);

CREATE TABLE IF NOT EXISTS workshop_memberships (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES workshop_groups(id),
  signup_id  TEXT NOT NULL REFERENCES workshop_signups(id),
  status     TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('trial', 'active', 'paused', 'ended')),
  started_at INTEGER NOT NULL,
  ended_at   INTEGER,
  notes      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(group_id, signup_id)
);
CREATE INDEX IF NOT EXISTS idx_workshop_memberships_group_status
  ON workshop_memberships(group_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workshop_memberships_one_open_signup
  ON workshop_memberships(signup_id)
  WHERE status IN ('trial', 'active', 'paused');

CREATE TABLE IF NOT EXISTS workshop_sessions (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES workshop_groups(id),
  starts_at  INTEGER NOT NULL,
  ends_at    INTEGER NOT NULL CHECK (ends_at > starts_at),
  status     TEXT NOT NULL DEFAULT 'scheduled'
               CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  location   TEXT NOT NULL,
  notes      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workshop_sessions_group_starts
  ON workshop_sessions(group_id, starts_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workshop_sessions_group_start_unique
  ON workshop_sessions(group_id, starts_at)
  WHERE status != 'cancelled';
CREATE INDEX IF NOT EXISTS idx_workshop_sessions_status_starts
  ON workshop_sessions(status, starts_at);

CREATE TABLE IF NOT EXISTS workshop_attendance (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES workshop_sessions(id),
  membership_id TEXT NOT NULL REFERENCES workshop_memberships(id),
  status        TEXT NOT NULL
                  CHECK (status IN ('unmarked', 'present', 'absent', 'excused')),
  notes         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE(session_id, membership_id)
);
CREATE INDEX IF NOT EXISTS idx_workshop_attendance_session
  ON workshop_attendance(session_id, status);
CREATE INDEX IF NOT EXISTS idx_workshop_attendance_membership
  ON workshop_attendance(membership_id, session_id);

CREATE TABLE IF NOT EXISTS workshop_payments (
  id            TEXT PRIMARY KEY,
  membership_id TEXT NOT NULL REFERENCES workshop_memberships(id),
  amount_grosze INTEGER NOT NULL CHECK (amount_grosze > 0),
  paid_at       INTEGER NOT NULL,
  method        TEXT NOT NULL
                  CHECK (method IN ('cash', 'transfer', 'card', 'voucher', 'other')),
  period_label  TEXT,
  notes         TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workshop_payments_membership_paid
  ON workshop_payments(membership_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_workshop_payments_paid
  ON workshop_payments(paid_at DESC);
