#!/usr/bin/env sh
set -eu
blocked=0
while read local_ref local_sha remote_ref remote_sha; do
  case "$remote_ref" in
    refs/heads/main) blocked=1 ;;
    refs/heads/release/*) blocked=1 ;;
  esac
done
if [ "$blocked" -eq 1 ]; then
  printf "Push bloqué: interdiction sur main et release/*\n"
  exit 1
fi
exit 0
