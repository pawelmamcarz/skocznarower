# Kalkulator mocy: korekta merytoryczna i UX

Poprzedni kalkulator zawyżał wpływ wiatru, pomijał pomoc grawitacji na zjeździe i mieszał wymaganą moc pedałowania z hamowaniem. Dodatkowe prognozy treningu, ciśnienie i rekomendacje zakupowe nie miały wystarczającej podstawy. Zastąpiono go bilansem mocy dla jednego prostego odcinka przy stałej prędkości. Założenia CdA/Crr są jawne i edytowalne.

Źródło wzorów: Martin i in. (1998), https://doi.org/10.1123/jab.14.3.276, równania 2, 6, 9 i 14. Model pomija przyspieszenie, boczny wiatr i osobny opór łożysk. Napływ od tyłu ma ten sam CdA, co jest dodatkowym uproszczeniem. Nie deklarujemy dokładności pomiarowej publikacji.

## Zakres

- Nowe physics.js, app.js, app.css i pełne słowniki PL/EN/UK.
- Cztery główne parametry, szczegóły modelu, podpisany bilans mocy i cztery niezależne porównania. Moc pedałowania oraz moc do rozproszenia są osobnymi wielkościami.
- Błędne/puste dane chowają stary wynik. Pola z ujemnymi wartościami nie wymuszają klawiatury decimal bez minusa.
- Usunięte GPX/FIT, pobieranie pogody oraz nieudokumentowany katalog opon. Parametry pozostają lokalne.
- Metadane, JSON-LD, treść i prywatność w trzech językach, llms i sitemap są zgodne z aktualnym narzędziem. Bez zmian Workera i schematu D1.

## Weryfikacja

- `npm test`: 92/92, w tym 28 testów kalkulatora oraz 64 testy Worker/D1.
- Niezależne wartości liczbowe: wiatr czołowy i tylny, wiatr szybszy niż rower, podjazd, zjazd, postój, bilans energii, granice i błędne typy danych.
- Chrome na lokalnym serwerze: PL/EN/UA × 360/390/768/1440 px. Aktualizacje wyniku, postój, zjazd, puste i przekroczone zakresy, reset, parametry zaawansowane, granice scenariuszy. 12/12 kombinacji bez błędów JS, zapytań API i przewijania poziomego.
- Statyczna kontrola 39 stron, 119 skryptów inline, JSON-LD, canonical/hreflang i lokalnych linków: 0 błędów. Zewnętrzne skrypty przeszły `node --check`.
- Wizualnie sprawdzone zrzuty desktop/mobile; porównania poprzedniej wersji pozostają w lokalnych plikach `/tmp/calculator-before-pl-390.png` i `/tmp/calculator-before-pl-1440.png`, nowe w `/tmp/calculator-pl-390.png` i `/tmp/calculator-pl-1440.png`.
- Po korekcie klawiatury i zaokrągleń ponowna kontrola PL/EN/UA × 390/1440 px: 6/6. Różnica w tabeli odpowiada widocznym, zaokrąglonym wartościom.
- Lokalny Wrangler na Node 26 i 22 zatrzymał się podczas startu; wejścia do strony kończyły się timeoutem. Kontrola UI używała lokalnego serwera statycznego. Suite Worker/D1 działał w Vitest. Weryfikacja publicznego adresu następuje po publikacji.
