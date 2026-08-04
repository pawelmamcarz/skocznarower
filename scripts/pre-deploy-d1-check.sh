#!/usr/bin/env bash
# PreToolUse: blokuje `wrangler deploy`, dopóki produkcyjna baza D1 nie ma
# zaaplikowanych wszystkich migracji z migrations/.
#
# Wspólny dla Claude Code (.claude/settings.json) i Codeksa (.codex/hooks.json):
# oba przekazują na stdin ten sam kształt JSON-a i rozumieją tę samą odpowiedź
# hookSpecificOutput. Codex bywa podaje tool_input.command jako tablicę argv,
# stąd flatten poniżej.
#
# Tło: 2026-07-27 wdrożono Workera z rate limitingiem, ale migracje 0015-0020
# nie poszły na produkcję. Każdy POST /api/bookings kończył się 500
# ("no such table: request_rate_limits") przez ~8 dni.

set -uo pipefail

payload=$(cat)
cmd=$(printf '%s' "$payload" | jq -r '
  [.tool_input.command, .tool_input.cmd, .tool_input.script]
  | flatten
  | map(select(type == "string"))
  | join(" ")
' 2>/dev/null)

# Sprawdzian, czy hook w ogóle działa w danym narzędziu: poproś agenta
# o uruchomienie `echo d1-hook-selftest`. Jeśli hook żyje, komenda zostanie
# zablokowana z komunikatem poniżej. Nic nie deployuje, nic nie zmienia.
case "$cmd" in
  *d1-hook-selftest*)
    jq -n '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:"Hook pre-deploy-d1-check działa. To był tylko test, nic nie zostało zablokowane naprawdę."}}'
    exit 0
    ;;
esac

# Interesuje nas tylko realny deploy Workera.
case "$cmd" in
  *wrangler*deploy*) ;;
  *) exit 0 ;;
esac
case "$cmd" in
  *--dry-run*|*"d1 "*|*versions*) exit 0 ;;
esac

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
config="$repo_root/wrangler.jsonc"
[ -f "$config" ] || exit 0

db=$(grep -o '"database_name"[[:space:]]*:[[:space:]]*"[^"]*"' "$config" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
[ -n "$db" ] || exit 0

out=$(cd "$repo_root" && npx --yes wrangler d1 migrations list "$db" --remote 2>&1)
rc=$?

if [ $rc -ne 0 ]; then
  jq -n --arg r "Nie udało się sprawdzić migracji D1 przed deployem (wrangler zwrócił błąd, np. brak sieci albo wygasła autoryzacja). Sprawdź ręcznie: npx wrangler d1 migrations list $db --remote" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"ask",permissionDecisionReason:$r}}'
  exit 0
fi

if printf '%s' "$out" | grep -q "No migrations to apply"; then
  exit 0
fi

pending=$(printf '%s' "$out" | grep -o '[0-9]\{4\}_[A-Za-z0-9_]*\.sql' | sort -u | paste -sd ' ' -)

jq -n --arg p "${pending:-(patrz: npx wrangler d1 migrations list $db --remote)}" --arg db "$db" \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:("Deploy zablokowany: produkcyjna baza D1 nie ma zaaplikowanych migracji: " + $p + ". Najpierw uruchom: npx wrangler d1 migrations apply " + $db + " --remote, potem powtórz deploy. (Wdrożenie kodu przed migracją to przyczyna awarii rezerwacji z 2026-07-27.)")}}'
exit 0
