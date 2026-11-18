"""Long-run numbers from chained nights.  python3 dynamics.py out/chains-<x>.jsonl"""
import json, sys, collections
from score import load, val, step
NIGHTS = 12  # a whole flat chain
rows = load(sys.argv[1])
chains = collections.defaultdict(list)
for r in rows: chains[r["chain"]].append(r)
POS = {"KP", "SP"}; NEG = {"KM", "SM"}; ORD = {"N1", "N2"}
def kind_of(t):
    """One answer for a night's kind. A day that is neither plainly good nor bad
    (`RM`, broken then repaired; `REAL`) is its own kind, and no event to follow."""
    return "ord" if t in ORD else "pos" if t in POS else "neg" if t in NEG else "mixed"
st = collections.Counter(); steps = collections.Counter()
for cid, ns in chains.items():
    ns.sort(key=lambda r: r["night"])
    arc = cid.split("-")[1]
    last_event = None
    for r in ns:
        for n in ("regard", "trust"):
            d = step(r, n)
            kind = kind_of(r["type"])
            st[(n, kind, "n")] += 1; steps[(n, kind)] += d
            st[(n, kind, "up")] += d > 0; st[(n, kind, "down")] += d < 0
            if kind == "ord" and last_event:
                st[(n, "after_" + last_event, "n")] += 1
                st[(n, "after_" + last_event, "up")] += d > 0; st[(n, "after_" + last_event, "down")] += d < 0
        of = kind_of(r["type"])
        if of != "ord": last_event = None if of == "mixed" else of
    if arc == "flat" and len(ns) < NIGHTS:
        # A run stopped partway: its nights count above, its total does not.
        st[("flatpartial", "", "n")] += 1
    elif arc == "flat":
        st[("flatchains", "", "n")] += 1
        for n in ("regard", "trust"):
            steps[("flat_total", n)] += val(ns[-1], "after", n) - val(ns[0], "before", n)
for n in ("trust", "regard"):
    print(f"{n}:")
    for kind, label in (("ord", "ordinary nights"), ("pos", "kindness / kept word"), ("neg", "slight / broken word"), ("mixed", "broken then repaired / other"), ("after_neg", "ordinary nights after a bad event"), ("after_pos", "ordinary nights after a good event")):
        N = st[(n, kind, "n")]
        if not N: continue
        extra = f", mean {steps[(n, kind)]/N:+.2f} steps a night" if kind in ("ord", "pos", "neg", "mixed") else ""
        print(f"   {label:36s} n={N:3d}  up {st[(n,kind,'up')]/N:4.0%}  down {st[(n,kind,'down')]/N:4.0%}{extra}")
F = st[("flatchains", "", "n")]
if F: print(f"{NIGHTS} ordinary days in a row ({F} chains): trust {steps[('flat_total','trust')]/F:+.1f} steps on average, regard {steps[('flat_total','regard')]/F:+.1f}")
P = st[("flatpartial", "", "n")]
if P: print(f"({P} flat chains not yet {NIGHTS} nights long are left out of that)")
