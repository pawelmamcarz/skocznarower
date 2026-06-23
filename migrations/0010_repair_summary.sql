-- Krótki opis wykonanej naprawy ("co zrobiono"), ustawiany przy oznaczaniu jako 'done'.
-- Trafia do SMS-a z podsumowaniem naprawy; jak puste, SMS używa nazwy usługi.
ALTER TABLE bookings ADD COLUMN repair_summary TEXT;
