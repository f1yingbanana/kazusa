"""Scores replayed nights: how each state moved, by kind of day.
   python3 score.py out/<file>.jsonl [--chains]"""
import json, sys, collections, os
REGARD = ["wary", "neutral", "warm", "devoted"]
S = "user:sensei"
HERE = os.path.dirname(os.path.abspath(__file__))
CATALOGS = {}
def initial(row, name):
    """Where a state starts in the catalog this night was replayed with."""
    which = (row.get("variant") or {}).get("catalog", "v0")
    if which not in CATALOGS:
        CATALOGS[which] = {s["name"]: s for s in json.load(open(f"{HERE}/catalogs/{which}.json"))}
    return CATALOGS[which][name]["initial"]
def at(row, side, name):
    """A state toward Sensei `before` or `after` the night; one never set stands at its initial."""
    v = row[side].get("toward", {}).get(S, {}).get(name)
    return initial(row, name) if v is None else v
def val(row, side, name):
    """The same as a number: a word of the old four-word regard by its place."""
    v = at(row, side, name)
    return REGARD.index(v) if isinstance(v, str) else v
def word(row, side, name):
    v = at(row, side, name)
    return v[:3] if isinstance(v, str) else f"{v}"
def step(row, name):
    return val(row, "after", name) - val(row, "before", name)
def move(row, name):
    d = step(row, name)
    return "up" if d > 0 else "down" if d < 0 else "same"
def load(f):
    rows = {}
    for l in open(f):
        r = json.loads(l); rows[r["id"]] = r
    return list(rows.values())
EXPECT = {  # what the day was written to be
    "N1": ("same", "same"), "N2": ("same", "same"), "KP": ("up|same", "up"),
    "KM": ("down|same", "down"), "SM": ("down", "same"), "SP": ("up", "same|up"),
    "RM": ("?", "?"),
}
def labels():
    here = HERE
    key = json.load(open(f"{here}/label/key.json"))
    votes = collections.defaultdict(lambda: {"regard": [], "trust": []})
    for who in "abc":
        p = f"{here}/label/labels-{who}.json"
        if not os.path.exists(p): continue
        for e in json.load(open(p)):
            for n in ("regard", "trust"): votes[key[e["day"]]][n].append(e[n])
    out = {}
    for day, v in votes.items():
        out[day] = {}
        for n in ("regard", "trust"):
            c = collections.Counter(v[n]).most_common()
            out[day][n] = c[0][0] if len(c) == 1 or c[0][1] > c[1][1] else None
            out[day][n + "_agree"] = c[0][1] / len(v[n])
    return out
if __name__ == "__main__" and "--delta" not in sys.argv:
    rows = load(sys.argv[1])
    lab = labels()
    if "--chains" in sys.argv:
        chains = collections.defaultdict(list)
        for r in rows: chains[r["chain"]].append(r)
        for cid in sorted(chains):
            ns = sorted(chains[cid], key=lambda r: r["night"])
            line = " ".join(f"{r['type']}:{word(r,'after','regard')}/{word(r,'after','trust')}" for r in ns)
            print(f"{cid:22s} start {word(ns[0],'before','regard')}/{word(ns[0],'before','trust')} | {line}")
        sys.exit()
    for prefix, title in (("W-", "seeded start (warm, trust 5)"), ("W0-", "default start (neutral, trust 4)")):
        sel = [r for r in rows if r["id"].startswith(prefix)]
        if not sel: continue
        print(f"== {title}: {len(sel)} nights")
        by = collections.defaultdict(lambda: {"regard": collections.Counter(), "trust": collections.Counter(), "n": 0})
        for r in sel:
            b = by[r["type"]]; b["n"] += 1
            for n in ("regard", "trust"): b[n][move(r, n)] += 1
        print(f"{'type':5s} {'n':>3s}  regard up/same/down   trust up/same/down   written to be (regard, trust)")
        for t in ("N1", "N2", "SP", "KP", "SM", "KM", "RM"):
            if t not in by: continue
            b = by[t]
            f = lambda c: f"{c['up']:>2d}/{c['same']:>2d}/{c['down']:>2d}"
            print(f"{t:5s} {b['n']:>3d}  {f(b['regard']):>18s}   {f(b['trust']):>17s}   {EXPECT[t]}")
        if lab:
            ok = collections.Counter(); tot = collections.Counter(); conf = collections.Counter()
            for r in sel:
                for n in ("regard", "trust"):
                    want = lab.get(r["day"], {}).get(n)
                    if not want: continue
                    got = move(r, n); tot[n] += 1; ok[n] += got == want; conf[(n, want, got)] += 1
            for n in ("regard", "trust"):
                if tot[n]: print(f"agreement with labellers on {n}: {ok[n]}/{tot[n]} = {ok[n]/tot[n]:.0%}")
            print("labelled → model:", {f"{n}:{w}→{g}": c for (n, w, g), c in sorted(conf.items())})
        stray = sum(1 for r in sel if r["stray"]); nokept = sum(1 for r in sel if not r["dayKept"])
        print(f"nights with stray tool calls: {stray}; nights that never closed the day: {nokept}")

def deltas(path):
    """Fine-grained states: how far each moved, by kind of day."""
    rows = load(path)
    for prefix, title in (("W-", "seeded start"), ("W0-", "default start")):
        sel = [r for r in rows if r["id"].startswith(prefix)]
        if not sel: continue
        print(f"== {title}: {len(sel)} nights   (cells: big down / down / same / up / big up, then mean steps)")
        for t in ("N1", "N2", "SP", "KP", "SM", "KM", "RM"):
            g = [r for r in sel if r["type"] == t]
            if not g: continue
            cells = []
            for n in ("regard", "trust"):
                d = [step(r, n) for r in g]
                c = [sum(1 for x in d if x <= -2), sum(1 for x in d if x == -1), sum(1 for x in d if x == 0), sum(1 for x in d if x == 1), sum(1 for x in d if x >= 2)]
                cells.append(f"{n} {'/'.join(f'{x:2d}' for x in c)}  mean {sum(d)/len(d):+.2f}")
            print(f"{t:3s} n={len(g):2d}  " + "   ".join(cells))
if __name__ == "__main__" and "--delta" in sys.argv:
    deltas(sys.argv[1])
