-- Transport jest opcją niezależną od naprawy; stare wpisy odbior zachowują notatki.
ALTER TABLE bookings ADD COLUMN pickup_requested INTEGER NOT NULL DEFAULT 0 CHECK (pickup_requested IN (0, 1));
ALTER TABLE bookings ADD COLUMN pickup_address TEXT;
UPDATE bookings SET pickup_requested=1 WHERE service_type='odbior';

-- Klucz jednej próby formularza zapobiega duplikatom po utracie odpowiedzi.
ALTER TABLE workshop_signups ADD COLUMN idempotency_key TEXT;
ALTER TABLE workshop_signups ADD COLUMN request_hash TEXT;
CREATE UNIQUE INDEX idx_workshop_signup_idempotency ON workshop_signups(idempotency_key) WHERE idempotency_key IS NOT NULL;
