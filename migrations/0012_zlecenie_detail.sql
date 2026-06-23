-- Rozbudowa strony zlecenia: terminy, notatki warsztatu, ręczne nadpisanie ceny końcowej.
-- Wszystko nullable, więc INSERT w createBookingCore i formularz publiczny działają bez zmian.
ALTER TABLE bookings ADD COLUMN accepted_at INTEGER;            -- termin przyjęcia (epoch ms); auto przy akcji 'start', ręcznie nadpisywalny
ALTER TABLE bookings ADD COLUMN done_at INTEGER;                -- moment oznaczenia jako 'done' (epoch ms); do osi czasu komunikacji
ALTER TABLE bookings ADD COLUMN expected_ready_date TEXT;       -- oczekiwany odbiór, YYYY-MM-DD, ręczny
ALTER TABLE bookings ADD COLUMN repair_info TEXT;               -- notatki warsztatu / info o naprawie (wewnętrzne, edytowalne)
ALTER TABLE bookings ADD COLUMN final_price_override INTEGER;   -- ręczne nadpisanie ceny końcowej; NULL = auto (parts_charged + labor_charge)

-- Log wiadomości wychodzących wysłanych z panelu (na razie SMS), żeby trafiały na oś czasu zlecenia.
-- Automatyczne SMS-y cyklu (przyjęto/gotowe/przypomnienie/opinia) są odtwarzane ze znaczników czasu, nie stąd.
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  booking_id  TEXT NOT NULL,
  direction   TEXT NOT NULL,   -- 'out' (z panelu do klienta)
  channel     TEXT NOT NULL,   -- 'sms'
  body        TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_booking ON messages(booking_id, created_at DESC);
