-- Id wydarzenia w Google Calendar, ustawiane gdy Mateusz potwierdzi rezerwację.
-- Pozwala zaktualizować/usunąć wydarzenie przy anulowaniu lub usunięciu rezerwacji.
ALTER TABLE bookings ADD COLUMN gcal_event_id TEXT;
