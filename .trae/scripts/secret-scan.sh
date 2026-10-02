#!/usr/bin/env sh
set -eu
FILES=$(git diff --cached --name-only)
if [ -z "$FILES" ]; then exit 0; fi
VIOLATIONS=""
case_ext() {
  case "$1" in
    *.py|*.js|*.ts|*.json|*.yml|*.yaml|*.md|*.env|*.toml|*.txt) return 0 ;;
    *) return 1 ;;
  esac
}
for f in $FILES; do
  b=$(basename "$f")
  if [ "$b" = ".env" ] || [ "$b" = "config.json" ]; then
    VIOLATIONS="$VIOLATIONS\n$f"
    continue
  fi
  if ! case_ext "$f"; then continue; fi
  if [ -f "$f" ]; then
    if grep -E -I -n "(API_KEY|TOKEN|SECRET|PASSWORD|ACCESS_KEY|BEGIN PRIVATE KEY|PRIVATE[ _-]?KEY|AKIA[0-9A-Z]{16}|Bearer[[:space:]]+[A-Za-z0-9\-\._]+)" "$f" > /dev/null 2>&1; then
      VIOLATIONS="$VIOLATIONS\n$f"
    fi
  fi
done
if [ -n "$VIOLATIONS" ]; then
  printf "[SECURITE] Blocage: fichiers/index avec motifs sensibles:%s\n" "$VIOLATIONS"
  exit 1
fi
exit 0
