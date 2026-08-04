#!/usr/bin/env bash
# Jedyna poprawna ścieżka wdrożenia: najpierw migracje D1, potem Worker.
#
# Powód: 2026-07-27 poszedł sam `wrangler deploy` bez migracji 0015-0020.
# Worker odwoływał się do nieistniejącej tabeli request_rate_limits, więc każdy
# POST /api/bookings zwracał 500 przez ~8 dni. Kolejność jest tu wymuszona.
#
# Użycie:  ./scripts/deploy.sh [dodatkowe flagi do wrangler deploy]

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

db=$(grep -o '"database_name"[[:space:]]*:[[:space:]]*"[^"]*"' wrangler.jsonc | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
if [ -z "$db" ]; then
  echo "Nie znalazłem database_name w wrangler.jsonc" >&2
  exit 1
fi

echo "==> Migracje D1 ($db, produkcja)"
npx --yes wrangler d1 migrations apply "$db" --remote

echo "==> Deploy Workera"
npx --yes wrangler deploy "$@"

echo "==> Smoke test"
code=$(curl -s -o /dev/null -w '%{http_code}' "https://www.skocznarower.pl/api/availability?date=$(date -u +%Y-%m-%d)")
echo "GET /api/availability -> $code"
[ "$code" = "200" ] || { echo "Uwaga: API nie odpowiada 200. Sprawdź logi: npx wrangler tail" >&2; exit 1; }
