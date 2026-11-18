#!/bin/sh
# Runs one condition's experiments side by side on OpenRouter; safe to rerun,
# each picks up where it stopped. Fails if any of them did.
#   ./run-all.sh <deep|low> [variant] [chains-concurrency]
cd "$(dirname "$0")"
cond="$1"; v="${2:-v0}"; c="${3:-16}"
export STATE_LAB_ROUTE=openrouter
[ "$cond" = deep ] && export STATE_LAB_EFFORT=high || export STATE_LAB_EFFORT=low
# `out/` is ignored, so a fresh checkout has none, and the logs open first.
mkdir -p out
pids=""
node nights.mjs plans/write-$v.json out/write-$v-$cond.jsonl 4 >> out/write-$v-$cond.log 2>&1 &
pids="$pids $!"
node nights.mjs plans/chains-$v.json out/chains-$v-$cond.jsonl "$c" >> out/chains-$v-$cond.log 2>&1 &
pids="$pids $!"
if [ -f plans/probes-$v.json ]; then
  node behave.mjs plans/probes-$v.json out/behave-$v-$cond.jsonl 4 >> out/behave-$v-$cond.log 2>&1 &
  pids="$pids $!"
fi
if [ "$v" = v0 ]; then
  node nights.mjs plans/calib.json out/calib-$cond.jsonl 3 >> out/calib-$cond.log 2>&1 &
  pids="$pids $!"
fi
failed=0
for pid in $pids; do wait "$pid" || failed=1; done
exit $failed
