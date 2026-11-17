"""Scores blind judges against the key.  python3 judge-score.py judge-v0-low"""
import json, sys, glob, os, collections
d = sys.argv[1]; key = json.load(open(f"{d}/key.json"))
for f in sorted(glob.glob(f"{d}/answers-*.json")):
    judge, probe = os.path.basename(f)[8:-5].split("-", 1)
    a = json.load(open(f)); ok = sum(1 for e in a if key[e["pair"]]["low"] == e["low"])
    sure = sum(e.get("sure", 0) for e in a) / len(a)
    print(f"{d[6:]:9s} {probe:10s} judge {judge}: {ok}/{len(a)} right, mean sureness {sure:.1f}")
