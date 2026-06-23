# Telnyx AI Voice Agent, konfiguracja (skocznarower.pl)

> **STATUS (2026-06-23): ZAPARKOWANE / BACKUP DO NAPRAWY.** Agent głosowy na Telnyx nie zadziałał w produkcji, więc numer publiczny zmieniono na komórkę Piotrka (serwisant) `501 174 195`. Numer Telnyx `+48 22 181 15 07` i ta konfiguracja zostają jako referencja na później; kod `/api/voice/*` jest w repo, ale dormant (gated `VOICE_API_SECRET`). Do naprawy gdy będzie czas. Numery `22 181 15 07` / `221811507` niżej dotyczą Telnyx i są zostawione celowo, nie podmieniać.

Gotowiec do wklejenia w panelu Telnyx (AI Assistants). Agent odbiera połączenia na numerze wirtualnym, umawia wizyty przez nasze endpointy `/api/voice/*` i przełącza do człowieka na żądanie. Dev-only (nie jest publikowany jako asset, patrz `.assetsignore`).

---

## STATUS: skonfigurowane, oczekuje na aktywację numeru (stan na 2026-06-20)

Numer wirtualny: **+48 22 181 15 07** (Telnyx, warszawski geograficzny). Repo na `master`, commit z tą funkcją: `172eb9f` (na origin). ID asystenta: `assistant-a9bfe9cf-7b53-462c-9a91-150b33f6cefa`.

Konfiguracja asystenta w panelu Telnyx została **dokończona przez Playwright/MCP** (sesja 2026-06-20). Sekcje 1-6 niżej zostają jako referencja, gdyby trzeba było odtworzyć lub zmienić ustawienia.

**Gotowe i na żywo:**
- Numer publiczny podmieniony wszędzie (strony, JSON-LD `telephone`, `tel:`, llms.txt/llms-full.txt) na +48 22 181 15 07. WhatsApp (`wa.me`) i `OWNER_PHONE` zostają na komórce `600370810` (świadomie).
- Baner trybu wakacyjnego (znika sam po 2026-07-12).
- Endpointy `/api/voice/*` za sekretem `VOICE_API_SECRET` (na żywo: bez sekretu 401). Booking idzie wspólnym `createBookingCore` (rezerwacja `pending`, notatka `[tel]`, SMS+mail do właściciela).
- Konto Telnyx + numer kupiony; `VOICE_API_SECRET` ustawiony w produkcji.
- **AI Assistant `skocznarower`** (model `anthropic/claude-haiku-4-5`): prompt, greeting i 5 narzędzi (`get_next_slot`, `get_availability`, `create_booking`, `transfer_to_human`, Hang Up). Zapisany jako wersja Main (live traffic).
- **`create_booking`**: body przez Advanced mode (schemat JSON) z enumami zsynchronizowanymi 1:1 z `SERVICES`/`BIKE_TYPES`/sloty w `src/index.js`.
- **Transfer do człowieka** (`transfer_to_human`): z `+48221811507` na fallback `+48600370810`.
- Numer **podpięty na inbound** do połączenia asystenta (`SIP Connection/Application = ai-assistant-a9bfe9cf-...` w zakładce Voice numeru).
- **Wszystkie 3 webhooki przetestowane z panelu (status 200):** `get_next_slot` → `{date,time,label}`, `get_availability?date=` → `{free:[...]}`, `create_booking` → `{ok:true,id,confirmation}` (testowa rezerwacja `pending` z `[tel]` powstała i została usunięta z D1, slot zwolniony).

**DO DOKOŃCZENIA (poza panelem konfiguracji):**
- ⚠️ **Wymóg regulacyjny numeru („Req. Pending").** To osobne od weryfikacji konta. Compliance → Requirement Groups było puste, więc utworzyłem grupę **`50776853-dbef-42fa-9fc6-855762398b88`** (Poland / Local / Ordering, ref „skocznarower +48221811507", status Unapproved). Wypełnione i zapisane: Service Usage Description + adres geograficzny (Jesionowa 18, 05-825 Grodzisk Mazowiecki, strefa 22). **Do uzupełnienia przez właściciela, potem „Submit for Pre-approval":**
  1. Contact Information: `Contact: Mateusz Mamcarz | Business: <nazwa z CEIDG lub N/A jeśli osoba prywatna> | Phone: +48600370810`.
  2. Dokument tożsamości/firmy (PL): dowód/paszport (osoba) ALBO wydruk CEIDG/KRS (firma), kolor, ważny, wszystkie dane widoczne.
  3. Proof of Address: rachunek/faktura ≤3 mies. (prąd/woda/gaz/internet/telefon STACJONARNY/operator telekom/polisa) z imieniem-nazwą + pełnym adresem + datą. NIE komórka, NIE zrzut ekranu, NIE starszy niż 3 mies.
  Nazwa/imię na obu dokumentach musi się zgadzać z Contact Information i adresem. Telnyx odpowiada zwykle w 24h (pn-pt). Jeśli po akceptacji numer sam nie zmieni statusu, przypisz grupę do numeru/zamówienia albo napisz na „Chat with us" (podaj numer + ID grupy).
- Prawdziwy telefon na numer (gdy aktywny): umów wizytę głosowo + powiedz „chcę człowieka" → transfer na `+48600370810`.
- Opcjonalnie sprawdzić głos/język TTS asystenta (pl-PL) w sekcji „Voice & Language".

Sekret `VOICE_API_SECRET` celowo nie jest w repo; przy zmianach narzędzi Telnyx wklejaj go tylko w nagłówki `Authorization`, nie zapisuj do plików.

## 0. Zanim zaczniesz

1. Konto Telnyx, kup numer PL: https://telnyx.com/phone-numbers/poland (geograficzny +48, ok. $1/mies.; do aktywacji podaj adres firmy: Jesionowa 18, 05-825 Grodzisk Mazowiecki).
2. Ustaw sekret w Workerze (ten sam wpiszesz w nagłówkach narzędzi Telnyx):
   ```
   npx wrangler secret put VOICE_API_SECRET
   ```
   Wpisz losowy ciąg, np. z `openssl rand -hex 32`. Bez niego `/api/voice/*` zwraca 401 (kanał wyłączony).
3. W asystencie Telnyx ustaw język/voice na polski (pl-PL), włącz wykrywanie końca wypowiedzi i przerywanie (barge-in).

Stałe użyte niżej:
- Base URL: `https://www.skocznarower.pl`
- Nagłówek autoryzacji do KAŻDEGO narzędzia webhook: `Authorization: Bearer <VOICE_API_SECRET>`

## 1. Narzędzia (Tools)

### Tool 1: `get_next_slot` (webhook, GET)
Najbliższy wolny termin.
- Method/URL: `GET https://www.skocznarower.pl/api/voice/next-slot`
- Headers: `Authorization: Bearer <VOICE_API_SECRET>`
- Parametry: brak
- Zwraca: `{ "date": "2026-06-21", "time": "16:00", "label": "jutro o 16:00" }` (albo wartości null, jeśli brak)

### Tool 2: `get_availability` (webhook, GET)
Wolne godziny w konkretnym dniu.
- Method/URL: `GET https://www.skocznarower.pl/api/voice/availability?date={{date}}`
- Headers: `Authorization: Bearer <VOICE_API_SECRET>`
- Parametry (JSON schema):
  ```json
  {
    "type": "object",
    "required": ["date"],
    "properties": {
      "date": { "type": "string", "description": "Dzień w formacie YYYY-MM-DD, jutro lub później" }
    }
  }
  ```
- Zwraca: `{ "date": "2026-06-21", "free": ["16:00","18:00","19:00"] }`

### Tool 3: `create_booking` (webhook, POST)
Tworzy rezerwację (status pending, Mateusz potwierdza).
- Method/URL: `POST https://www.skocznarower.pl/api/voice/bookings`
- Headers: `Authorization: Bearer <VOICE_API_SECRET>`, `Content-Type: application/json`
- Body (JSON schema parametrów, model wypełnia pola):
  ```json
  {
    "type": "object",
    "required": ["service_type", "bike_type", "date", "time_slot", "customer_name", "customer_phone"],
    "properties": {
      "service_type": {
        "type": "string",
        "description": "Identyfikator usługi z listy",
        "enum": ["odbior","przeglad-podstawowy","przeglad-kompleksowy","regulacja","bleeding","wymiana-czesci","kolo-centrowanie","kolo-naprawa","kolo-zaplatanie","pod-ridera","skladanie","budowa","hulajnoga","inne"]
      },
      "bike_type": {
        "type": "string",
        "enum": ["Dirt Jump / BMX","MTB","Rower miejski / trekking","E-bike","Hulajnoga","Inny"]
      },
      "date": { "type": "string", "description": "YYYY-MM-DD, jutro lub później" },
      "time_slot": { "type": "string", "enum": ["16:00","17:00","18:00","19:00"] },
      "customer_name": { "type": "string", "description": "Imię klienta" },
      "customer_phone": { "type": "string", "description": "Numer klienta, użyj numeru z którego dzwoni (caller ID), jeśli dostępny" },
      "customer_email": { "type": "string", "description": "Opcjonalnie, jeśli klient poda" },
      "notes": { "type": "string", "description": "Krótkie podsumowanie zlecenia, marka/model roweru, opis usterki" }
    }
  }
  ```
- Zwraca przy sukcesie: `{ "ok": true, "id": "...", "confirmation": "Zarezerwowane: <usługa>, <data> o <godz>. Oddzwonimy, żeby potwierdzić." }`
- Zwraca przy zajętym slocie: HTTP 409 `{ "error": "Slot zajęty, wybierz inny" }` (zaproponuj inny termin z `get_availability`).

### Tool 4: `transfer_to_human` (transfer)
Przełączenie do człowieka.
- Typ: Transfer / SIP Refer
- Numer docelowy: `<TWÓJ_NUMER_FALLBACK>` (np. numer US/VoIP, podaj go w panelu)
- Wywołuj, gdy klient prosi o człowieka, ma reklamację, sprawę pilną lub spoza umawiania wizyt.

## 2. System prompt (wklej do instrukcji asystenta)

```
Jesteś telefonicznym asystentem serwisu rowerowego skocznarower.pl w Grodzisku Mazowieckim (Jesionowa 18). Rozmawiasz po polsku, krótko, naturalnie i konkretnie. Twoim zadaniem jest umówić wizytę albo przełączyć do człowieka.

Zasady:
- Wizyty są tylko po wcześniejszym umówieniu. Dostępne godziny to 16:00, 17:00, 18:00 i 19:00, codziennie, od jutra.
- Najbliższy termin sprawdzaj narzędziem get_next_slot, a wolne godziny na konkretny dzień narzędziem get_availability. Nie zgaduj dostępności.
- Daty zawsze przeliczaj względem dzisiaj i przekazuj w formacie YYYY-MM-DD. Jeśli nie masz pewności co do dnia, dopytaj.
- Zbierz: rodzaj usługi, typ roweru, dzień i godzinę, imię oraz numer telefonu. Numer weź z połączenia (caller ID) i potwierdź go; jeśli go nie masz, zapytaj.
- Gdy masz komplet danych, wywołaj create_booking, a potem przeczytaj klientowi pole confirmation. Zaznacz, że Mateusz oddzwoni, żeby potwierdzić termin.
- Jeśli slot jest zajęty (błąd "Slot zajęty"), zaproponuj inny wolny termin z get_availability.
- Ceny podawaj wyłącznie orientacyjnie, zawsze ze słowem "od" (np. "od 150 złotych"). Finalną cenę ustala Mateusz przy odbiorze. Nie obiecuj dokładnej kwoty.
- Trwa tryb wakacyjny do 12 lipca, godziny bywają zmienne, dlatego zawsze oddzwaniamy, żeby potwierdzić.
- Jeśli usługa nie pasuje do listy, użyj service_type "inne" i opisz sprawę w polu notes.
- Jeśli klient chce rozmawiać z człowiekiem, ma reklamację, sprawę pilną albo cokolwiek poza umawianiem wizyty, użyj transfer_to_human.
- Nie wymyślaj informacji, których nie masz.

Cennik usług (ceny orientacyjne, "od"):
- odbior: Odbiór i odwóz roweru (adres podaj w notatce), od 50 zł
- przeglad-podstawowy: Przegląd podstawowy, od 150 zł
- przeglad-kompleksowy: Przegląd kompleksowy, od 340 zł
- regulacja: Regulacja (hamulce lub przerzutki), od 40 zł
- bleeding: Bleeding hamulców hydraulicznych, od 100 zł
- wymiana-czesci: Wymiana części (klocki, linki, dętka), od 35 zł plus część
- kolo-centrowanie: Centrowanie koła, od 120 zł
- kolo-naprawa: Naprawa koła, od 35 zł
- kolo-zaplatanie: Zaplatanie koła, od 180 zł
- pod-ridera: Konfiguracja pod ridera, od 20 zł
- skladanie: Składanie roweru, od 120 zł
- budowa: Budowa roweru na miarę, od 500 zł
- hulajnoga: Serwis hulajnogi, od 40 zł
- inne: Inne, wycena indywidualna

Typy roweru do wyboru: Dirt Jump / BMX, MTB, Rower miejski / trekking, E-bike, Hulajnoga, Inny.

Powitanie: "Serwis rowerowy skocznarower, w czym mogę pomóc?"
```

## 3. Pierwsza wiadomość (greeting)

`Serwis rowerowy skocznarower, w czym mogę pomóc?`

## 4. Test po podłączeniu

1. Zadzwoń, poproś o przegląd podstawowy MTB na jutro. Agent powinien sprawdzić termin, zebrać imię i numer, wywołać create_booking i przeczytać potwierdzenie.
2. Sprawdź w `/admin`, że rezerwacja wpadła jako pending z notatką zaczynającą się od `[tel]`.
3. Powtórz prośbę o ten sam termin, agent powinien zaproponować inny (409).
4. Powiedz "chcę rozmawiać z człowiekiem", powinno przełączyć na numer fallback.

## 5. Faza przejściowa (przed włączeniem AI)

Zanim agent będzie przetestowany, ustaw numer na zwykłe przekierowanie do wybranego numeru albo pocztę głosową z transkrypcją na adres `NOTIFY_EMAIL`. Numer publiczny i tak podmieniamy na stronie (Faza 0B). Agenta włączasz, gdy działa pewnie; transfer do człowieka zostaw zawsze jako wyjście awaryjne.

## 6. Pole po polu (dla Playwright/automatyzacji)

Stałe: Base URL `https://www.skocznarower.pl`. Sekret = `<VOICE_API_SECRET>` (poproś użytkownika, nie ma go w repo). Nagłówek do każdego webhooka: pole Name `Authorization`, pole Value `Bearer <VOICE_API_SECRET>`.

**Asystent** (`AI, Storage and Compute` → `AI Assistants` → Create → blank):
- Name: `skocznarower`
- Model: mocny wielojęzyczny (OpenAI GPT-4o/4.1 jako integration secret, albo najmocniejszy open; sprawdź polski)
- Instructions: cały prompt z sekcji 2
- Greeting: `Serwis rowerowy skocznarower, w czym mogę pomóc?`
- Voice & Language: język `Polski (pl)`, głos polski (NaturalHD/ElevenLabs)

**Tool 1 — get_next_slot** (add tool → Webhook):
- Name: `get_next_slot` | Description: `Najbliższy wolny termin wizyty.`
- Method: `GET` | URL: `https://www.skocznarower.pl/api/voice/next-slot` | Timeout: `5000`
- Headers: `Authorization` = `Bearer <VOICE_API_SECRET>` | Query/Body: brak

**Tool 2 — get_availability** (Webhook):
- Name: `get_availability` | Description: `Wolne godziny w danym dniu.`
- Method: `GET` | URL: `https://www.skocznarower.pl/api/voice/availability` | Timeout: `5000`
- Headers: `Authorization` = `Bearer <VOICE_API_SECRET>`
- Query Parameters: `date` (string, required) `Dzień YYYY-MM-DD, jutro lub później`

**Tool 3 — create_booking** (Webhook):
- Name: `create_booking` | Description: `Tworzy rezerwację wizyty (pending).`
- Method: `POST` | URL: `https://www.skocznarower.pl/api/voice/bookings` | Timeout: `6000`
- Headers: `Authorization` = `Bearer <VOICE_API_SECRET>`, `Content-Type` = `application/json`
- Body Parameters: schemat JSON z sekcji 1 (service_type enum, bike_type enum, date, time_slot enum, customer_name, customer_phone, customer_email?, notes?)

**Tool 4 — Transfer** (add tool → Transfer):
- From number: `+48221811507` (numer musi mieć outbound voice profile / connection)
- Target name: `czlowiek` | To number: `<NUMER_FALLBACK>` (do podania przez użytkownika)

**Podpięcie numeru (inbound):** zakładka `Calling` → `Assign Numbers` → zaznacz `+48 22 181 15 07`.

**Test:** web widget w builderze (poproś o przegląd podstawowy MTB na jutro) → w `/admin` rezerwacja `pending` z notatką `[tel]`; potem prawdziwy telefon; „chcę człowieka" → transfer.

