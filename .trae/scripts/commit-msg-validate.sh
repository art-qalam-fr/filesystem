#!/usr/bin/env sh
set -eu
FILE="$1"
MSG=$(head -n 1 "$FILE" | tr -d '\r')
echo "$MSG" | grep -Eq '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?: .{1,}$' || { printf "Commit invalide: respecter Conventional Commits\n"; exit 1; }
exit 0
