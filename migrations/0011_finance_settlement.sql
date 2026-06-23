-- Rozliczenie Mateusz/Piotr + model roweru. Wszystkie kwoty w złotych (INTEGER).
-- Zysk do podziału = narzut na częściach (parts_charged - parts_cost) + robocizna (labor_charge).
-- Domyślny podział 75% Mateusz / 25% Piotr; gdy usługę robi Mateusz sam -> 100% dla niego.
ALTER TABLE bookings ADD COLUMN bike_model TEXT;
ALTER TABLE bookings ADD COLUMN parts_cost INTEGER;       -- faktyczny koszt części (wydane)
ALTER TABLE bookings ADD COLUMN parts_charged INTEGER;    -- cena części dla klienta (z narzutem)
ALTER TABLE bookings ADD COLUMN labor_charge INTEGER;     -- robocizna / cena usługi dla klienta
ALTER TABLE bookings ADD COLUMN amount_paid INTEGER;      -- ile klient faktycznie zapłacił
ALTER TABLE bookings ADD COLUMN payment_method TEXT;      -- 'cash' | 'blik' | 'transfer'
ALTER TABLE bookings ADD COLUMN service_by TEXT;          -- 'piotr' | 'mateusz' (kto wykonał usługę)
ALTER TABLE bookings ADD COLUMN parts_by TEXT;            -- 'mateusz' | 'piotr' | 'klient' (kto kupił części)
ALTER TABLE bookings ADD COLUMN paid_to TEXT;             -- 'piotr' | 'mateusz' (kto odebrał kasę; domyślnie z metody)
ALTER TABLE bookings ADD COLUMN settled_at INTEGER;       -- znacznik rozliczenia (NULL = nierozliczone)
