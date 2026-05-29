-- Zapobiega podwójnej rezerwacji tego samego slotu przy równoległych POST /api/bookings.
-- Indeks częściowy: tylko aktywne (nieanulowane) rezerwacje muszą mieć unikalny (date, time_slot).
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active_slot
  ON bookings (date, time_slot)
  WHERE status != 'cancelled';
