"""Long-run numbers from chained nights.  python3 dynamics.py out/chains-<x>.jsonl"""
import json, sys, collections
from score import load, val, step
NIGHTS = 12  # a whole flat chain
rows = load(sys.argv[1])
chains = collections.defaultdict(list)
for r in rows: chains[r["chain"]].append(r)
POS = {"KP", "SP"}; NEG = {"KM", "SM"}; ORD = {"N1", "N2"}
st = collections.Counter(); steps = collections.Counter()
for cid, ns in chains.items():
    ns.sort(key=lambda r: r["night"])
    arc = cid.split("-")[1]
    last_event = None
    for r in ns:
        for n in ("regard", "trust"):
            d = step(r, n)
            kind = "ord" if r["type"] in ORD else "pos" if r["type"] in POS else "neg"
            st[(n, kind, "n")] += 1; steps[(n, kind)] += d
            st[(n, kind, "up")] += d > 0; st[(n, kind, "down")] += d < 0
            if kind == "ord" and last_event:
                st[(n, "after_" + last_event, "n")] += 1
                st[(n, "after_" + last_event, "up")] += d > 0; st[(n, "after_" + last_event, "down")] += d < 0
        if r["type"] not in ORD: last_event = "neg" if r["type"] in NEG else "pos"
    if arc == "flat" and len(ns) < NIGHTS:
        # A run stopped partway: its nights count above, its total does not.
        st[("flatpartial", "", "n")] += 1
    elif arc == "flat":
        st[("flatchains", "", "n")] += 1
        for n in ("regard", "trust"):
            steps[("flat_total", n)] += val(ns[-1], "after", n) - val(ns[0], "before", n)
for n in ("trust", "regard"):
    print(f"{n}:")
    for kind, label in (("ord", "ordinary nights"), ("pos", "kindness / kept word"), ("neg", "slight / broken word"), ("after_neg", "ordinary nights after a bad event"), ("after_pos", "ordinary nights after a good event")):
        N = st[(n, kind, "n")]
        if not N: continue
        extra = f", mean {steps[(n, kind)]/N:+.2f} steps a night" if kind in ("ord", "pos", "neg") else ""
        print(f"   {label:36s} n={N:3d}  up {st[(n,kind,'up')]/N:4.0%}  down {st[(n,kind,'down')]/N:4.0%}{extra}")
F = st[("flatchains", "", "n")]
if F: print(f"{NIGHTS} ordinary days in a row ({F} chains): trust {steps[('flat_total','trust')]/F:+.1f} steps on average, regard {steps[('flat_total','regard')]/F:+.1f}")
P = st[("flatpartial", "", "n")]
if P: print(f"({P} flat chains not yet {NIGHTS} nights long are left out of that)")
