-- Tabela do trackowania outreach do brandów / dystrybutorów / sklepów bez warsztatu.
-- Channel: A = brand (dealer + ambasador), B = polski dystrybutor / program serwisowy, C = sklep bez warsztatu (recommended-local / pickup-hub / warranty).
-- Status: planned (zaplanowany), sent (wysłany), responded (odpisali), closed (zamknięty: deal lub nie).

CREATE TABLE IF NOT EXISTS outreach_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_name TEXT NOT NULL,
  channel TEXT NOT NULL,
  contact_method TEXT,
  sent_at INTEGER,
  status TEXT NOT NULL DEFAULT 'planned',
  response TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outreach_status ON outreach_contacts(status);
CREATE INDEX IF NOT EXISTS idx_outreach_channel ON outreach_contacts(channel);

-- Seed top targets z OUTREACH_PLAN.md. Velo.pl już wysłany 2026-05-17.
INSERT INTO outreach_contacts (brand_name, channel, contact_method, status, sent_at, notes, created_at, updated_at) VALUES
  ('Velo.pl', 'B', 'velo.pl/wspolpraca-z-serwisami-rowerowymi (formularz)', 'sent', 1779047100000, 'Wysłany 2026-05-17 wieczorem przed planem', unixepoch()*1000, unixepoch()*1000),
  ('Miasto Rowerów B2B', 'B', 'biznes.miastorowerow.pl (rejestracja)', 'planned', NULL, 'Rejestracja darmowa, brak min. zamówienia, dropshipping', unixepoch()*1000, unixepoch()*1000),
  ('Canyon Service Partners', 'C', 'servicepartner@canyon.com / canyon.com formularz', 'planned', NULL, 'Oficjalny program, luka w okolicy Warszawy', unixepoch()*1000, unixepoch()*1000),
  ('Radon Bikes Service Partner', 'C', 'service@radon-bikes.de / radon-bikes.de/en/service/service-partner', 'planned', NULL, 'Oficjalny program, PL słabo pokryta', unixepoch()*1000, unixepoch()*1000),
  ('Shimano Service Center PL', 'B', 'ssc.shimano.com/pl/dolacz-do-shimano-service-center', 'planned', NULL, 'Wymaga certyfikatu mechanika + narzędzi Shimano', unixepoch()*1000, unixepoch()*1000),
  ('Dartmoor Bikes', 'A', 'dartmoor-bikes.com/contact + IG @dartbikes', 'planned', NULL, 'PL Gliwice, niche 5/5, mają Team / Friends / Shredders', unixepoch()*1000, unixepoch()*1000),
  ('NS Bikes', 'A', 'nsbikes.com/distributors,504,pl.html + IG @nsbikes', 'planned', NULL, 'PL Lublin, niche 5/5, nowy Decade DJ frame', unixepoch()*1000, unixepoch()*1000),
  ('Magura PL (Mateusz Zoń, Żywiec)', 'A', 'magura.pl/kontakt', 'planned', NULL, 'Bleeding niche perfect fit, bezpośrednio do PL dystrybutora', unixepoch()*1000, unixepoch()*1000),
  ('Muc-Off', 'A', 'muc-off.com/pages/brand-ambassador (form)', 'planned', NULL, 'Ambassador Crew, TikTok 15k = ich sweet spot', unixepoch()*1000, unixepoch()*1000),
  ('Kunstform BMX', 'C', 'info@kunstform.org', 'planned', NULL, 'DE, niche 1:1 z BMX/DJ, custom assembly Poland = zero konkurencji', unixepoch()*1000, unixepoch()*1000),
  ('Rose Bikes', 'C', 'bikesales@rosebikes.com', 'planned', NULL, 'Sami w gwarancji wymagają serwisu 300 km z pieczątką', unixepoch()*1000, unixepoch()*1000),
  ('YT Industries', 'C', 'service@yt-industries.com', 'planned', NULL, 'Claimy PL = ich ból, brak partnerów lokalnych', unixepoch()*1000, unixepoch()*1000),
  ('Kross autoryzacja serwisowa', 'B', 'service@kross.pl', 'planned', NULL, 'Sieć przeglądów gwarancyjnych, HQ Przasnysz blisko WAW', unixepoch()*1000, unixepoch()*1000),
  ('Octane One', 'A', 'octane-one.com + FB @OctaneOne', 'planned', NULL, 'Aktywni, nowe modele 2025 (Diezel, Melt EVO)', unixepoch()*1000, unixepoch()*1000),
  ('Aspire Sports (SRAM PL)', 'B', 'aspire.eu/en/dealers/poland', 'planned', NULL, 'PL dystrybutor SRAM, dealer + service', unixepoch()*1000, unixepoch()*1000),
  ('Centrum Rowerowe pickup-hub', 'C', 'b2b@centrumrowerowe.pl', 'planned', NULL, 'Salony WRO/POZ, Mazowsze = czysta luka pickup/assembly', unixepoch()*1000, unixepoch()*1000),
  ('Tubolito (refresh)', 'A', 'tubolito.com/dealers + reuse aplikacji z uploads/', 'planned', NULL, 'Mamy gotowy PDF do zaktualizowania', unixepoch()*1000, unixepoch()*1000),
  ('Manyfest BMX (bridge do WTP/Eclat/Sunday)', 'B', 'manyfestbmx.pl', 'planned', NULL, 'PL retail, kontakt do BMX brandów bez ścigania zagranicznych distro', unixepoch()*1000, unixepoch()*1000);
