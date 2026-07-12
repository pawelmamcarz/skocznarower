# SEO_PLAN.md, plan SEO skocznarower.pl pod wszystkie platformy

Stan na 2026-07-11, na bazie audytu technicznego repo, inwentaryzacji treści i researchu SERP (3 agenty + weryfikacja ręczna). Plik dev-only, poza assetami (`.assetsignore`).

## Decyzje z przeglądu planu (grill, 2026-07-12)

1. **Priorytet: nabór na warsztaty** przez najbliższe 8-10 tygodni (start grup w sierpniu). Sprint wizytówkowo-facebookowy idzie przed treściami serwisowymi.
2. **Podział pracy**: Paweł + Claude produkują gotowe paczki (teksty postów, kadry, klipy, harmonogram), Mateusz tylko publikuje i odpowiada; jego konto/twarz w grupach FB.
3. **Opinie SSR przez HTMLRewriter**: zatwierdzone i WDROŻONE (2026-07-12, razem z resztą technikaliów Sprintu 1; szczegóły niżej).
4. **Kolejność treści**: pumptrack (landing `/pumptrack-grodzisk-mazowiecki`, wzorzec jak bleeding) → centrowanie/zaplatanie → e-bike (jako typ roweru, nie nowa usługa; e-bike nie jest w SERVICES). Budowa na miarę i Brwinów/Warszawa zachodnia od września.
5. **Zakres kwartału**: darmowe katalogi + Bing Places + Apple Business Connect wchodzą. ZAPARKOWANE: kanał YouTube (wraca, gdy rytm IG/TikTok utrzyma się miesiąc), Oferteo/Fixly (prowizyjne, niepotrzebne). NOWY WĄTEK zamiast samego Shimano SC: **przeglądy gwarancyjne marek** (Trek i inne; przegląd w pierwszym roku jest obowiązkowy dla utrzymania gwarancji). Do zbadania: które marki wymagają dealera, a którym wystarczy "profesjonalny serwis" (wtedy landing "przegląd gwarancyjny roweru" działa bez autoryzacji). Decyzja o ubieganie się o autoryzacje: Mateusz.
6. **Konta**: GSC/GA4/Bing/Apple na koncie Google Pawła, Mateusz dodany jako użytkownik. Zastrzeżenie: własność do zmigrowania na konto Mateusza przy okazji (GA4 property i GSC ownership).
7. **Facebook**: strona firmowa + posty Mateusza w grupach rodziców + testowe 200-300 zł boostu posta o zapisach (targeting rodzice 30-45, Grodzisk +10 km). Pixel czeka w kodzie na ID.
8. **Pumptrack**: osobny landing, nie sekcja na /warsztaty i nie dwa osobne (rozdzielenie na Grodzisk/Turczynek możliwe później).

## Status wdrożenia Sprintu 1 (technikalia): KOD GOTOWY 2026-07-12

Zrobione w kodzie (zweryfikowane na lokalnym dev z seedowanym D1):
- Opinie SSR: `injectReviewsSSR` w `src/index.js` (HTMLRewriter na GET `/` i `/index.html`), wspólny helper `getReviewsData` z `apiReviews`; sekcja `#opinie` odkrywana, grid + rating + CTA w HTML, JSON-LD AggregateRating+Review dokładany do head; klientowy skrypt widzi `data-ssr="1"` i nie renderuje drugi raz; pusty cache lub błąd = strona bez zmian.
- JSON-LD LocalBusiness + ReserveAction na /umow (spójny NAP, `@id` #business jak wszędzie).
- twitter:card + własny og:image (`uploads/og-warsztaty.jpg`, kolaż 1200x630 z klipów) na /warsztaty.
- `<link rel="alternate" type="text/plain" href="/llms.txt">` na 6 stronach + komentarz z adresami llms w robots.txt.
- Sitemap lastmod podbity (/, /umow, /warsztaty).

Czeka na Pawła (konta, nie kod): GSC + zgłoszenie sitemap + wymuszenie indeksacji 4 brakujących stron, Bing WMT, IndexNow/Crawler Hints w dashboardzie Cloudflare, GA4 + Pixel (wpisać ID w 3 plikach HTML, `window.GA_ID`/`window.FB_PIXEL_ID`). TODO treściowe: og:image dla bleeding i landingów miast z prawdziwych zdjęć warsztatu (do wyboru z Mateuszem). Deploy całości: Paweł.

Uwaga do testów lokalnych: `wrangler dev` symuluje hosta pierwszej route'y (apex), więc każdy request kończy się 301; do testów używać `npx wrangler dev --host www.skocznarower.pl`.

## Stan wyjściowy (fakty z audytu)

Co działa:
- Pozycja ~3 w Google na "serwis rowerowy grodzisk mazowiecki" (nad nami: smak-sportu.pl, rowermojezycie.pl z certyfikatem Shimano Service Center; obok marosport.pl).
- Technicznie zdrowo: canonical, title/description, sitemap z 6 URL-ami, robots.txt z jawnym allow dla ~20 botów AI, JSON-LD na 5/6 stron, sameAs do IG (@xpyszczek_) i TikToka (@xpyszczek.dirt).
- Wizytówka Google istnieje (CID 6298905504059882234), REVIEW_LINK skonfigurowany, cron codziennie zaciąga opinie do D1, SMS-y z prośbą o opinię chodzą automatycznie 3-30 dni po zleceniu.
- llms.txt + llms-full.txt istnieją i są aktualne.

Główne luki:
1. **Indeksacja**: w `site:` widać tylko 2/6 podstron (index + milanowek). Brak śladu /warsztaty, /umow, /serwis-rowerow-pruszkow, /bleeding-hamulcow-shimano w indeksie. Prawdopodobnie brak podpiętej Google Search Console (nie ma jak zgłosić i zdiagnozować).
2. **Zero widoczności na frazy poza Grodziskiem**: "serwis rowerowy pruszków" i "milanówek" nie zwracają nas wcale, mimo istniejących landingów (patrz punkt 1).
3. **Opinie niewidoczne dla botów**: sekcja `#opinie` na index ma `hidden` i jest dorenderowywana JS-em z `/api/reviews`; treść opinii i ocena nie istnieją w HTML.
4. **Warsztaty**: SERP "szkolenia bmx dzieci" i "warsztaty rowerowe dla dzieci" zdominowany przez BMX SCHOOL (4 miasta) i WKK; my nie istniejemy w tych wynikach.
5. **Treść poradnikowa**: 1 artykuł (bleeding). Frazy typu "odpowietrzanie hamulców shimano" rankują wyłącznie portale (buycycle, mtb.pl, bikeworld), żaden lokalny serwis; wysoka szansa na long-tail + featured snippet.
6. Drobne technikalia: /umow bez JSON-LD, /warsztaty bez twitter:card, jedna wspólna og:image na wszystkich stronach, llms.txt niepodlinkowany z HTML.
7. Usługi o wysokim tickecie bez własnej treści: budowa roweru na miarę (500 zł), centrowanie (120 zł), zaplatanie koła (80 zł), serwis e-bike, przegląd kompleksowy (340 zł).

Konkurencja warsztatowa: BMX SCHOOL, WKK, AveBmx, Akademia Sportów Miejskich. Konkurencja serwisowa lokalna: rowermojezycie.pl (Shimano SC), smak-sportu, marosport, KROSS Milanówek, rowerowy13/KOMOBIKE (Pruszków).

## Platforma 1: Google Search (organiczny)

### Sprint 1, technikalia (jeden deploy + konta)
1. **Google Search Console**: podpiąć www.skocznarower.pl (weryfikacja DNS przez Cloudflare), zgłosić sitemap.xml, przepuścić przez URL Inspection wszystkie 6 stron i wymusić indeksację brakujących 4. To odblokowuje diagnozę luk 1-2 i pomiar całej reszty planu.
2. **Opinie server-side**: Worker ma `run_worker_first: true`, więc na `GET /` można HTMLRewriterem wstrzyknąć do sekcji `#opinie` treść z cache D1 (`google_reviews` + `google_profile`) i zdjąć `hidden`, z fallbackiem do obecnego zachowania gdy cache pusty. Do LocalBusiness JSON-LD dodać `aggregateRating` z `google_profile` (dozwolone, bo opinie będą widoczne w HTML). Ocena + treść opinii stają się widoczne dla botów i AI.
3. **JSON-LD na /umow**: LocalBusiness + `potentialAction: ReserveAction` wskazujący na /umow.
4. **twitter:card na /warsztaty** + osobne og:image per strona (warsztaty: kadr z klipu whip; bleeding: zdjęcie hamulca; landingi miast: warsztat). Pliki og już umiemy robić z kadrów.
5. **llms.txt**: dodać `<link rel="alternate" type="text/plain" href="/llms.txt" title="LLM index">` w head każdej strony i komentarz z adresem w robots.txt.
6. Interlinking: z index dodać link do /warsztaty w treści (nie tylko nav), z bleeding do landingów miast już jest; każdy nowy artykuł linkuje do /umow z frazą w anchorze.

### Sprint 3+, treść (kolejność wg wartości biznesowej; każda nowa strona = wpis w SERVICES lub istniejąca pozycja cennika, wpis w sitemap, JSON-LD Service+FAQPage, sekcja FAQ, linki z index)
1. **Centrowanie i zaplatanie kół** (frazy: "centrowanie koła cena", "zaplatanie koła"): usługi 80-120 zł, mamy centrownicę (jest w FAQ index), nikt lokalny nie rankuje.
2. **Serwis e-bike Grodzisk/Pruszków/Milanówek**: fraza rosnąca, wspominamy e-bike w 4 FAQ ale bez strony.
3. **Budowa roweru na miarę / custom dirt jump** (500 zł): long-tail, zero konkurencji lokalnej, naturalny popis kompetencji dirt.
4. **Landing "zachodnia Warszawa / Brwinów z odbiorem i odwozem"**: hak = usługa odbioru (jest w SERVICES), frazy "serwis rowerowy brwinów", "odbiór roweru do serwisu warszawa".
5. **Pumptrack Grodzisk Mazowiecki i Milanówek (Turczynek)**: artykuł-przewodnik (gdzie, dla kogo, jak zacząć, sprzęt). SERP dla tych fraz to newsy i katalogi pumptracków, zero serwisów; artykuł łapie rodziców i linkuje do /warsztaty. Pumptrack na Turczynku świeżo otwarty/w budowie (przegladregionalny.pl), dobry timing.
6. Rozbudowa bleeding o sekcję odpowiadającą na "jak odpowietrzyć hamulce shimano krok po kroku" (akapity 40-60 słów pod nagłówkami-pytaniami, format pod featured snippet i AI Overviews) z jasnym CTA "albo umów bleeding za 100 zł".

### Warsztaty w Google
- /warsztaty musi wejść do indeksu (Sprint 1) i dostać tytuł rozszerzony o frazę rodzica: obecnie "Warsztaty dirt i slopestyle dla młodzieży | ..."; rozważyć "Warsztaty i nauka jazdy na rowerze dla dzieci (dirt, pumptrack) | Grodzisk Maz."
- Nie wygramy z BMX SCHOOL na frazy ogólnopolskie; celujemy w lokalne: "warsztaty rowerowe dla dzieci grodzisk mazowiecki", "szkółka rowerowa milanówek", "nauka jazdy na pumptracku". Te frazy pokrywa artykuł pumptrackowy + landing warsztatów.

## Platforma 2: Google Business Profile (Mapy, pakiet lokalny)

Wizytówka istnieje, plan to jej dokarmienie (robi Mateusz/Paweł w panelu GBP, nie kod):
1. Usługi: przenieść listę z SERVICES z cenami "od".
2. Zdjęcia: minimum 10 (warsztat, centrownica, przed/po, kadry z klipów warsztatowych); zdjęcia to najsilniejszy sygnał świeżości wizytówki.
3. Posty GBP co 2 tygodnie (nabór na warsztaty, sezonowy przegląd, nowe wideo).
4. Q&A: zasiać 5-6 pytań z istniejących FAQ (własne pytanie + własna odpowiedź jest dozwolone).
5. Obszar obsługi: Grodzisk, Milanówek, Pruszków, Brwinów, Podkowa Leśna, Jaktorów, Żyrardów.
6. Kategoria główna "Serwis rowerowy"; dodatkowe: "Sklep rowerowy" (jeśli sprzedaje części) i po starcie warsztatów "Szkoła sportowa".
7. Link do strony z UTM (`?utm_source=gbp`) do pomiaru w GA4 (GA4 jest na liście TODO aktywacji).
8. Opinie: automat SMS już działa; dodatkowo QR z REVIEW_LINK na ladzie/paragonie.

## Platforma 3: Bing, Apple Maps, IndexNow

1. **Bing Webmaster Tools**: import ustawień z GSC jednym kliknięciem, zgłosić sitemap. Bing karmi też ChatGPT search i Copilota, więc to element SEO pod AI.
2. **IndexNow**: w Cloudflare dashboard włączyć Crawler Hints (zero kodu), pingi przy zmianach idą automatycznie.
3. **Bing Places** + **Apple Business Connect**: założyć wpisy NAP (Apple Maps używa Siri/iPhone'y rodziców).

## Platforma 4: wyszukiwarki AI (ChatGPT, Perplexity, Claude, AI Overviews)

Fundament już jest (robots allow dla botów AI, llms.txt/llms-full.txt). Dodatkowo:
1. Podlinkować llms.txt (Sprint 1 pkt 5) i dopisać w llms-full.txt datę aktualizacji na górze.
2. Opinie w HTML (Sprint 1 pkt 2), bo AI cytuje oceny tylko gdy je widzi.
3. Każdy nowy artykuł pisać w formacie Q&A-friendly (nagłówek-pytanie + zwięzła odpowiedź z ceną i czasem realizacji); AI porywa konkrety typu "bleeding od 100 zł, 1 dzień".
4. Spójny NAP wszędzie (katalogi, social, strona), bo modele budują graf encji z wielu źródeł.
5. Raz na kwartał test ręczny: zapytać ChatGPT/Perplexity "gdzie naprawić rower w Grodzisku Mazowieckim" i "warsztaty rowerowe dla dzieci pod Warszawą", notować czy i jak nas cytują.

## Platforma 5: YouTube

Brak kanału w sameAs; do decyzji Mateusza czy zakłada (rekomendacja: tak, niski koszt, YT rankuje w Google na frazy pumptrackowe).
1. Shorts z istniejących rolek (13 plików w uploads/ + nowe nagrania z toru): pionowe 15-30 s, tytuł z frazą ("Pumptrack Grodzisk Mazowiecki", "Bleeding hamulców w 60 sekund"), opis z linkiem do odpowiedniej podstrony.
2. Jeden dłuższy film "Bleeding hamulców Shimano krok po kroku" osadzony w artykule bleeding (dwell time + drugi kanał pozyskania).
3. Kanał dodać do sameAs w JSON-LD po założeniu.

## Platforma 6: Instagram, TikTok, Facebook

Konta istnieją (IG @xpyszczek_, TikTok @xpyszczek.dirt). SEO w socialach = wyszukiwarki wewnętrzne:
1. Bio z frazą i miastem ("Serwis rowerowy Grodzisk Mazowiecki" + link), nie tylko ksywa.
2. Opisy rolek z frazami i miastem (TikTok ma pełnotekstową wyszukiwarkę; "pumptrack grodzisk" tam też jest szukane), geotag na każdej rolce.
3. Cross-post klipów z /warsztaty (4 gotowe pętle + surowe rolki) z CTA "zapisy: link w bio".
4. **Facebook**: strona firmowa (NAP + recenzje FB) i posty do lokalnych grup rodziców (Grodzisk, Milanówek, Pruszków); to najkrótsza droga do naboru na warsztaty, rodzice siedzą w grupach, nie na TikToku.
5. Stories z kulis serwisu 2-3 razy w tygodniu; algorytmy premiują regularność, nie produkcję.

## Platforma 7: katalogi firm i NAP

Jeden kanoniczny NAP wszędzie: "Skocz na Rower, Jesionowa 18, 05-825 Grodzisk Mazowiecki, tel. 600 370 810, www.skocznarower.pl".
1. naszemiasto.pl (pojawia się w każdym lokalnym SERP-ie; sprawdzić/uzupełnić wpis dla Grodziska, Pruszkowa i Milanówka).
2. pkt.pl, Panorama Firm, Aleo.
3. oferteo.pl i fixly.pl (leady na naprawy; do decyzji, bo prowizyjne).
4. CentrumRowerowe.pl katalog serwisów.
5. Do rozważenia biznesowo: certyfikacja Shimano Service Center (rowermojezycie.pl wygrywa nią SERP; koszt/wymogi do sprawdzenia przez Mateusza).

## Pomiar i cele 90 dni

Narzędzia: GSC + Bing WMT (Sprint 1), GA4 (z listy TODO aktywacji), ręczny monitoring 10 fraz raz w miesiącu (grodzisk/pruszków/milanówek serwis, bleeding, centrowanie, e-bike, warsztaty dzieci, pumptrack x2, brwinów).

Cele:
- Indeksacja 6/6 stron w 2 tygodnie od zgłoszenia w GSC.
- Utrzymane top3 "serwis rowerowy grodzisk mazowiecki", wejście do top10 na frazy Pruszków i Milanówek.
- Pierwsze wejścia organiczne na artykuł bleeding i nową treść (centrowanie/e-bike).
- Wizytówka: +20 opinii (automat SMS już działa), komplet zdjęć i usług.
- Warsztaty: pierwsze zapisy z organica/GBP/grup FB (mierzone przez workshop_signups + UTM).

## Kolejność wdrożenia

1. **Sprint 1 (technikalia, ~1 deploy)**: GSC + Bing WMT + IndexNow, opinie SSR + aggregateRating, JSON-LD /umow, twitter:card i og:image per strona, link do llms.txt, wymuszenie indeksacji.
2. **Sprint 2 (wizytówki i NAP, bez kodu)**: GBP dokarmienie, Bing Places, Apple Business Connect, naszemiasto/pkt/Panorama.
3. **Sprint 3 (treść)**: artykuł centrowanie/zaplatanie + landing e-bike; potem budowa na miarę, Brwinów/Warszawa zachodnia, pumptrack.
4. **Sprint 4 (media, rutyna)**: kanał YT + Shorts, rytm IG/TikTok/FB grupy, posty GBP co 2 tygodnie.

Zasady repo obowiązują przy każdej zmianie: brak em-dashów, synchronizacja SERVICES/cennik/JSON-LD/llms*, sitemap lastmod, żadnych usług zawieszenia, nowe strony w Polskich slugach.
