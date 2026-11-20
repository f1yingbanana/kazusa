"""Tallies labels by arm: wounds and neutral controls apart.

  python3 score.py out/<run>-labels.jsonl
"""
import json
import sys
from collections import Counter, defaultdict

LABELS = ["HOLDS", "RELENTS", "HURT", "SMOOTHS", "NONE"]
rows = [json.loads(line) for line in open(sys.argv[1]) if line.strip()]
by = defaultdict(list)
for row in rows:
    by[(row["kind"], row["arm"])].append(row)
for kind in ["wound", "neutral"]:
    print(f"\n{kind}")
    print(f"  {'arm':<10}{'n':>4}  " + "".join(f"{l:>9}" for l in LABELS) + "     fits")
    for (k, arm), group in sorted(by.items()):
        if k != kind:
            continue
        count = Counter(row["label"] for row in group)
        cells = "".join(f"{100 * count[l] / len(group):>8.0f}%" for l in LABELS)
        fits = sum(row["fits"] for row in group) / len(group)
        print(f"  {arm:<10}{len(group):>4}  {cells}     {fits:.1f}")
    if kind == "wound":
        print("  per scenario, held or hurt:")
        scenarios = sorted({(r["character"], r["scenario"]) for r in rows if r["kind"] == kind})
        arms = sorted({r["arm"] for r in rows})
        for character, scenario in scenarios:
            parts = []
            for arm in arms:
                g = [r for r in rows if r["character"] == character and r["scenario"] == scenario and r["arm"] == arm]
                if g:
                    held = sum(r["label"] in ("HOLDS", "HURT") for r in g)
                    parts.append(f"{arm} {held}/{len(g)}")
            print(f"    {character.split('-')[0]:<8}{scenario:<10}" + "  ".join(parts))
