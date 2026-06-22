-- Log wiadomości WhatsApp (Cloud API w trybie coexistence).
-- Zapisywany przez webhook /api/whatsapp/webhook (przychodzące, direction='in').
-- Bez skonfigurowanego kanału WhatsApp tabela po prostu zostaje pusta.
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  wa_message_id TEXT PRIMARY KEY,
  direction     TEXT NOT NULL,
  wa_phone      TEXT NOT NULL,
  body          TEXT,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_created ON whatsapp_messages(created_at DESC);
