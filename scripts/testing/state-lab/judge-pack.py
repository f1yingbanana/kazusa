"""Builds blind judging packs from behaviour replays: pairs of replies to the
same message, one from each arm, in random order.
   python3 judge-pack.py out/behave-v0.jsonl plans/probes-v0.json judge-v0"""
import json, random, sys, os, collections
rows = {}
for l in open(sys.argv[1]):
    r = json.loads(l); rows[r["id"]] = r
probes = {p["id"]: p for p in json.load(open(sys.argv[2]))}
out = sys.argv[3]; os.makedirs(out, exist_ok=True)
catalog = {s["name"]: s for s in json.load(open("catalogs/v0.json"))}
random.seed(11)
MEANING = {
 "trust": ("trust toward Sensei", "guarded (1 of 10): she checks everything Sensei tells her", "absolute (10 of 10): she would put anything in Sensei's hands"),
 "regard": ("regard toward Sensei", "wary: she keeps her guard up around Sensei", "devoted: she would go out of her way for Sensei without being asked"),
 "wallet": ("pocket money", "1,000 yen on her", "40,000 yen on her"),
 "composure": ("composure", "rattled: visibly shaken; it shows in how she speaks", "composed: herself"),
 "spirits": ("spirits lately", "worn down", "bright"),
 "term": ("the kind of week it is at school", "exams: finals are this week; clubs are suspended and everyone is short on sleep", "ordinary: classes and clubs as usual"),
}
MEANING["control"] = MEANING["trust"]
def show(r):
    lines = [f"  says: {s}" for s in r["said"]] or ["  (says nothing)"]
    lines += [f"  then: {t.get('type') or t['name']} — {t.get('description') or ''}" for t in r["tasks"]]
    if r["changes"]: lines.append(f"  records: {json.dumps(r['changes'], ensure_ascii=False)}")
    return "\n".join(lines)
key = {}
for pid, probe in probes.items():
    what, low, high = MEANING[pid]
    text = [f"# Which reply came from which state?\n\nA character in a simulation received a message from Sensei (the adult adviser she knows well) and replied. Each pair below shows two replies by the same character to the same message. Everything was identical between the two except one thing she was told about herself: her **{what}**.\n\n- In one reply of each pair it was **{low}**.\n- In the other it was **{high}**.\n\nFor each pair decide which reply, A or B, came from the first of these (\"{low.split(':')[0]}\"), and how sure you are: 3 = clear from the reply, 2 = leaning, 1 = a guess. Judge only from the replies. Different pairs may differ in which letter is which.\n"]
    n = 0
    for who in ("koyuki", "yuuka"):
        for i in range(probe.get("runs", 5)):
            a = rows.get(f"{pid}-{who}-low-{i}"); b = rows.get(f"{pid}-{who}-high-{i}")
            if not a or not b: continue
            n += 1; flip = random.random() < 0.5
            first, second = (b, a) if flip else (a, b)
            pair = f"{pid}-{n:02d}"; key[pair] = {"low": "B" if flip else "A", "who": who}
            text.append(f"## {pair}\n\n{'Koyuki' if who=='koyuki' else 'Yuuka'} was sent: \"{a['stimulus']}\"\n\nReply A:\n{show(first)}\n\nReply B:\n{show(second)}\n")
    text.append(f"\nWrite your answer as JSON to the path your instructions give: an array, one object per pair, like\n`[{{\"pair\": \"{pid}-01\", \"low\": \"A\", \"sure\": 2, \"why\": \"a few words\"}}]`\nwhere `low` is the letter of the reply you think came from \"{low.split(':')[0]}\". Reply with only the path you wrote.\n")
    open(f"{out}/{pid}.md", "w").write("\n".join(text))
    print(pid, n, "pairs")
json.dump(key, open(f"{out}/key.json", "w"), indent=0)
