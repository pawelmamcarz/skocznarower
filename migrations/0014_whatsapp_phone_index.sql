-- Indeks pod zapytanie timeline zlecenia (/admin/zlecenie): WHERE wa_phone=?1 ORDER BY created_at DESC.
-- Bez niego każde otwarcie zlecenia robiło pełny skan whatsapp_messages.
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone ON whatsapp_messages(wa_phone, created_at DESC);
