-- Win-back: znacznik wysłania SMS reaktywacyjnego (epoch ms).
-- Stempel jest stawiany per numer telefonu (UPDATE wszystkich wierszy danego klienta),
-- więc każdy klient dostaje win-back raz na cykl. NULL = jeszcze nie wysłano.
ALTER TABLE bookings ADD COLUMN winback_sent_at INTEGER;
