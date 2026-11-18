"""Scores blind judges against the key.  python3 judge-score.py judge-v0-low"""
import json, sys, glob, os, collections
d = sys.argv[1]; key = json.load(open(f"{d}/key.json"))
bad = 0
for f in sorted(glob.glob(f"{d}/answers-*.json")):
    judge, probe = os.path.basename(f)[8:-5].split("-", 1)
    a = json.load(open(f))
    # Every pair of the pack, once: a judge who skipped the hard ones is not accurate.
    want = {pair for pair in key if pair.rsplit("-", 1)[0] == probe}
    seen = collections.Counter(e.get("pair") for e in a)
    wrong = [f"missing {p}" for p in sorted(want - set(seen))] + [f"not in the pack {p}" for p in sorted(set(seen) - want, key=str)] + [f"twice {p}" for p, n in sorted(seen.items(), key=str) if n > 1]
    if wrong:
        bad += 1
        print(f"{d[6:]:9s} {probe:10s} judge {judge}: not scored, {'; '.join(wrong[:6])}{' …' if len(wrong) > 6 else ''}")
        continue
    ok = sum(1 for e in a if key[e["pair"]]["low"] == e["low"])
    sure = sum(e.get("sure", 0) for e in a) / len(a)
    print(f"{d[6:]:9s} {probe:10s} judge {judge}: {ok}/{len(a)} right, mean sureness {sure:.1f}")
sys.exit(1 if bad else 0)
