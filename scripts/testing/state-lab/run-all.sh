#!/bin/sh
# Runs one condition's experiments side by side on OpenRouter; safe to rerun,
# each picks up where it stopped.
#   ./run-all.sh <deep|low> [variant] [chains-concurrency]
cd "$(dirname "$0")"
cond="$1"; v="${2:-v0}"; c="${3:-16}"
export STATE_LAB_ROUTE=openrouter
[ "$cond" = deep ] && export STATE_LAB_EFFORT=high || export STATE_LAB_EFFORT=low
node nights.mjs plans/write-$v.json out/write-$v-$cond.jsonl 4 >> out/write-$v-$cond.log 2>&1 &
node nights.mjs plans/chains-$v.json out/chains-$v-$cond.jsonl "$c" >> out/chains-$v-$cond.log 2>&1 &
[ -f plans/probes-$v.json ] && node behave.mjs plans/probes-$v.json out/behave-$v-$cond.jsonl 4 >> out/behave-$v-$cond.log 2>&1 &
[ "$v" = v0 ] && node nights.mjs plans/calib.json out/calib-$cond.jsonl 3 >> out/calib-$cond.log 2>&1 &
wait
