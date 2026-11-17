"""Scores replayed nights: how each state moved, by kind of day.
   python3 score.py out/<file>.jsonl [--chains]"""
import json, sys, collections, os
REGARD = ["wary", "neutral", "warm", "devoted"]
FINE = not any(("-v0" in a or "-v1" in a) for a in sys.argv)
S = "user:sensei"
def raw(plain, name):
    return plain.get("toward", {}).get(S, {}).get(name)
def num(v, name, like=None):
    """A value as a number; a missing one is the state's initial, in the scale `like` is on."""
    if v is None:
        # The state's initial: 12 on the fine scale (v2), 4 on the old one.
        if isinstance(like, (int, float)) and like >= 11 and FINE: return 12
        if name == "trust" or isinstance(like, (int, float)): return 4
        return 1
    return REGARD.index(v) if isinstance(v, str) else v
def val(plain, name, other=None):
    v = raw(plain, name)
    return num(v, name, raw(other, name) if other else None)
def word(plain, name):
    v = raw(plain, name)
    if name == "regard" and isinstance(v, (int, float)): return f"{v}"
    if name == "regard": return (v or "neutral")[:3]
    return str(4 if v is None else v)
def move(row, name):
    d = val(row["after"], name, row["before"]) - val(row["before"], name, row["after"])
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
    here = os.path.dirname(os.path.abspath(__file__))
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
            line = " ".join(f"{r['type']}:{word(r['after'],'regard')}/{word(r['after'],'trust')}" for r in ns)
            start = ns[0]["before"]
            print(f"{cid:22s} start {word(start,'regard')}/{word(start,'trust')} | {line}")
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
                d = [val(r["after"], n, r["before"]) - val(r["before"], n, r["after"]) for r in g]
                c = [sum(1 for x in d if x <= -2), sum(1 for x in d if x == -1), sum(1 for x in d if x == 0), sum(1 for x in d if x == 1), sum(1 for x in d if x >= 2)]
                cells.append(f"{n} {'/'.join(f'{x:2d}' for x in c)}  mean {sum(d)/len(d):+.2f}")
            print(f"{t:3s} n={len(g):2d}  " + "   ".join(cells))
if __name__ == "__main__" and "--delta" in sys.argv:
    deltas(sys.argv[1])
