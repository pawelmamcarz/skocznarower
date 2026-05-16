-- Pola do śledzenia, czy SMS przypominający i SMS prośby o opinię zostały wysłane.
-- NULL = nie wysłany, INTEGER = unix ms timestamp wysłania.
ALTER TABLE bookings ADD COLUMN reminder_sent_at INTEGER;
ALTER TABLE bookings ADD COLUMN feedback_sent_at INTEGER;
