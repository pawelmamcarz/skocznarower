-- Odpowiedź rodzica na proponowany termin próbny. Link jest podpisywany HMAC-em
-- z identyfikatorem zgłoszenia i aktualnym trial_at, więc zmiana terminu
-- automatycznie unieważnia starszy link bez przechowywania surowego tokenu.

ALTER TABLE workshop_signups ADD COLUMN trial_response TEXT;
ALTER TABLE workshop_signups ADD COLUMN trial_response_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_workshop_signups_trial_response
  ON workshop_signups(status, trial_response, trial_at);
