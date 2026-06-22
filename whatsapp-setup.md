# WhatsApp na numerze 600370810 (setup)

Dokument dev-only (jest w `.assetsignore`, nie publikuje się jako asset). Numer 600370810 ma już zainstalowaną aplikację WhatsApp Business. Cel: zostawić aplikację na telefonie (tryb **coexistence**) i dodatkowo podpiąć Cloud API, żeby Worker mógł wysyłać potwierdzenia/przypomnienia i odbierać wiadomości.

Podział: **kod po stronie Workera jest gotowy i fail-soft** (bez sekretów nic nie wysyła, produkcja bez zmian). Poniższe kroki to robota konta/onboardingu, którą wykonuje właściciel.

---

## Faza 0: quick-win bez kodu (od ręki, w aplikacji WA Business)

1. **Wiadomość „poza biurem" 24/7** (Narzędzia firmowe → Wiadomość poza biurem → Zawsze wysyłaj):
   > Cześć! Piszesz do serwisu Skocznarower (Grodzisk Maz.). Najszybciej umówisz wizytę online: skocznarower.pl/umow. Napisz tu, w czym pomóc, odpiszemy najszybciej jak się da. Telefon bywa nieodebrany, WhatsApp i formularz działają najlepiej.
2. **Wiadomość powitalna** (krótsza, dla nowych kontaktów) z linkiem do `skocznarower.pl/umow`.
3. **Połączone urządzenia**: podepnij laptop (WhatsApp Web/Desktop), żeby ktoś w PL mógł odpisywać z biurka. Do 4 urządzeń, działają nawet gdy telefon offline. Telefon trzeba uruchomić min. raz na 14 dni, inaczej sesje wygasają.
4. Uzupełnij profil firmowy (adres, link do strony, godziny).

---

## Faza 2a: wybór providera (gating reszty)

Napisz do **SMSAPI** i **Telnyx** (są tam konta) jedno pytanie: *czy wspieracie onboarding „WhatsApp Business App Coexistence" (Embedded Signup dla numeru już używanego w aplikacji WA Business), czy wymagana jest pełna migracja numeru?*

- **Tak** u któregoś → zostajemy przy nim (najlepiej SMSAPI, polski, już zintegrowany SMS-owo).
- **Nie** u obu → **360dialog** (coexistence pewny, dobrze udokumentowany) albo świadoma zgoda na pełną migrację (numer **wypadłby** z aplikacji WA Business; tego unikamy).

Kod Workera celuje domyślnie w **Meta Cloud API (Graph)**; 360dialog jest z tym zgodny. Dla SMSAPI/Telnyx/360dialog może trzeba dostroić host i nagłówek auth w `sendWhatsApp` (`WHATSAPP_API_BASE`, ewentualnie inny nagłówek) oraz parser webhooka.

---

## Faza 2b: Meta / WABA / coexistence (właściciel, ~3-7 dni roboczych)

1. **Weryfikacja biznesowa Meta** (JDG wystarczy): wpis CEIDG (NIP/REGON), dokument tożsamości, dowód adresu (Jesionowa 18), strona skocznarower.pl jako dowód działalności.
2. **WABA + coexistence embedded signup** u wybranego providera: zeskanowanie kodu QR z istniejącej aplikacji WA Business (numer zostaje w aplikacji, historia ~6 mies. się synchronizuje). Działa też zza granicy, byle telefon z aplikacją był pod ręką.
3. **Nazwa wyświetlana** (zatwierdzenie 1-2 dni).
4. **Webhook**: w panelu Meta/providera ustaw URL `https://www.skocznarower.pl/api/whatsapp/webhook`, jako verify token wpisz wartość `WHATSAPP_VERIFY_TOKEN`, subskrybuj pole `messages`.

Limity coexistence do świadomości: 5 wiad./s (dla warsztatu nadmiarowo wystarcza), brak „green tick" w czatach 1:1, szablony tylko przez API (nie z aplikacji), aplikację otwierać raz na 14 dni.

---

## Szablony (pre-approval w Meta, język PL)

Treści muszą zgadzać się z kolejnością parametrów, których używa kod. Bez myślników (konwencja repo).

- **`potwierdzenie_rezerwacji`** (utility), parametry `{{1}}`=imię, `{{2}}`=data, `{{3}}`=godzina, `{{4}}`=usługa:
  > Cześć {{1}}! Przyjąłem zgłoszenie na {{2}} o {{3}} ({{4}}). Odezwę się, żeby potwierdzić termin. Skocznarower, Jesionowa 18 Grodzisk Maz.
- **`przypomnienie_wizyty`** (utility), parametry `{{1}}`=imię, `{{2}}`=godzina:
  > Cześć {{1}}! Przypomnienie: jutro o {{2}} wizyta w skocznarower.pl, Jesionowa 18 Grodzisk Maz. Jakby coś, napisz tutaj.

Prośba o opinię na razie zostaje na SMS (w `sendFollowUps`), żeby nie płacić za szablon marketingowy. Jeśli kiedyś przeniesiemy ją na WA, trzeba dodać szablon marketingowy i podpiąć analogicznie.

---

## Sekrety produkcyjne (po onboardingu)

```bash
npx wrangler secret put WHATSAPP_TOKEN              # token dostępu (Meta/BSP)
npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID    # Phone Number ID z WABA
npx wrangler secret put WHATSAPP_VERIFY_TOKEN       # ten sam, co w panelu webhooka
npx wrangler secret put WHATSAPP_APP_SECRET         # App Secret aplikacji Meta (weryfikacja podpisu)
# opcjonalne nadpisania: WHATSAPP_API_BASE, WHATSAPP_API_VERSION, WHATSAPP_LANG,
#                        WHATSAPP_TPL_CONFIRM, WHATSAPP_TPL_REMINDER, WHATSAPP_AUTO_ACK
```

Migracja D1 na log wiadomości:
```bash
npx wrangler d1 migrations apply skocznarower-db --remote   # wgra 0009_whatsapp_messages.sql
```

---

## Jak to działa w kodzie (po ustawieniu sekretów)

- `sendWhatsApp(env, phone, message)` w `src/index.js`: wysyłka przez Graph API, fail-soft (bez tokena dry-run do logów).
- Webhook `GET/POST /api/whatsapp/webhook`: GET to handshake (`hub.challenge`), POST weryfikuje podpis `X-Hub-Signature-256` i loguje/zapisuje wiadomości; zawsze 200.
- `sendNotifications`: po rezerwacji wysyła klientowi potwierdzenie szablonem `potwierdzenie_rezerwacji` (obok maila). SMS-alert do właściciela bez zmian.
- `sendDailyReminders` (cron): przypomnienie 24h szablonem `przypomnienie_wizyty`, SMS jako fallback gdy WA niedostępne.

## Testy po wdrożeniu

- Handshake: `curl "https://www.skocznarower.pl/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=TWOJ_TOKEN&hub.challenge=test123"` zwraca `test123`.
- Rezerwacja testowa: klient z numerem na WhatsAppie dostaje potwierdzenie (lub `[WA dry-run]` w logach, jeśli sekrety nieustawione).
- Wiadomość od klienta: pojawia się w aplikacji (coexistence) i w logach Workera `[WA inbound]`.
