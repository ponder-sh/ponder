#!/usr/bin/env bash
# Run the regression seeds and N random seeds for one app, then report all results.
#
# Usage: ./run-seeds.sh <app id> <random seed count> [--no-regression]
#
# Exit codes of `pnpm test`: 0 = pass, 1 = validation or Ponder failure,
# 2 = infrastructure error (template or rpc cache), 124 = timeout.

set -uo pipefail

APP_ID="$1"
RANDOM_SEEDS="$2"
REGRESSION="${3:-}"
SEED_TIMEOUT="${SEED_TIMEOUT:-900}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

seeds=()
if [ "$REGRESSION" != "--no-regression" ]; then
  while read -r app seed _; do
    [ "$app" = "$APP_ID" ] && seeds+=("$seed")
  done < <(grep -v '^\s*#' regression-seeds.txt | grep -v '^\s*$')
fi
for ((i = 0; i < RANDOM_SEEDS; i++)); do
  seeds+=("$(openssl rand -hex 32)")
done

failed=0
echo "### $APP_ID" >> "$SUMMARY"
echo "| seed | result | duration |" >> "$SUMMARY"
echo "| --- | --- | --- |" >> "$SUMMARY"

for seed in "${seeds[@]}"; do
  echo "::group::$APP_ID $seed"
  start=$(date +%s)
  SEED="$seed" timeout --kill-after=30 "$SEED_TIMEOUT" bun run src/index.ts "$APP_ID"
  code=$?
  duration=$(($(date +%s) - start))
  echo "::endgroup::"

  case $code in
    0) result="pass" ;;
    2) result="INFRA ERROR" ;;
    124 | 137) result="TIMEOUT" ;;
    *) result="FAIL ($code)" ;;
  esac

  if [ $code -ne 0 ]; then
    failed=1
    echo "::error title=$APP_ID $result::SEED=$seed pnpm test $APP_ID"
  fi
  echo "| \`$seed\` | $result | ${duration}s |" >> "$SUMMARY"
done

exit $failed
