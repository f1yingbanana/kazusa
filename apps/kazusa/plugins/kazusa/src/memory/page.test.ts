import { describe, expect, it } from "vitest";
import { parsePage } from "./page.ts";

describe("parsePage", () => {
  it("reads a world page in layers", () => {
    const page = parsePage(
      `---
summary: Feared and overworked.
aliases: [Prefects]
community: gehenna_academy
renown: known
---

# Prefect Team

Everyone in Gehenna knows them.

## Inner workings

Shift rotations.

## Ako's ledger

Known by: hina-sorasaki, ako-amau

Only these two.

## History

- 2026-10-24 — Patrols suspended.
- 2026-10-25 · news — Announced on the portal.
`,
      "concepts/prefect_team.md",
    );
    expect(page).toMatchObject({
      id: "prefect_team",
      kind: "concept",
      name: "Prefect Team",
      summary: "Feared and overworked.",
      lead: "Everyone in Gehenna knows them.",
      community: "gehenna_academy",
      renown: "known",
      history: [
        { date: "2026-10-24", news: false, text: "Patrols suspended." },
        { date: "2026-10-25", news: true, text: "Announced on the portal." },
      ],
    });
    expect(page.sections).toEqual([
      { title: "Inner workings", text: "Shift rotations.", knownBy: [] },
      {
        title: "Ako's ledger",
        text: "Only these two.",
        knownBy: ["hina-sorasaki", "ako-amau"],
      },
    ]);
  });

  it("reads a personal page's notes, threads and guess", () => {
    const page = parsePage(
      `---
peer_id: user:sensei
name: Sensei
relation: mentor
---

Keeps showing up at the club.

## What they think of me

Probably finds me prickly. (think so)

## Open threads

- Owes me a cake.

## Notes

- 2026-10-22 · told by natsu-yutori · suspect — He hates mint.
- not a note
`,
      "entities/characters/sensei.md",
    );
    expect(page).toMatchObject({
      kind: "person",
      personId: "user:sensei",
      relation: "mentor",
      lead: "Keeps showing up at the club.",
      theyThinkOfMe: "Probably finds me prickly. (think so)",
      openThreads: ["Owes me a cake."],
      notes: [
        {
          date: "2026-10-22",
          source: "told by natsu-yutori",
          certainty: "suspect",
          text: "He hates mint.",
        },
      ],
    });
    expect(page.problems).toEqual(["malformed note: - not a note"]);
  });

  it("falls back to the lead's first sentence and the H1 name", () => {
    const page = parsePage(
      "# Angel 24\n\nOpen all night. Bright.\n",
      "entities/places/angel_24.md",
    );
    expect(page).toMatchObject({
      kind: "place",
      name: "Angel 24",
      summary: "Open all night.",
    });
  });

  it("survives broken front matter and flags number fields", () => {
    expect(
      parsePage("---\n: : :\n---\nBody.", "concepts/x.md").problems[0],
    ).toMatch(/not YAML/);
    expect(
      parsePage("---\ntrust: 70\n---\nBody.", "entities/characters/x.md")
        .problems,
    ).toEqual(["`trust` is a number; use `relation` words"]);
  });

  it("splits a full name into aliases", () => {
    const page = parsePage(
      "---\nfull_name: Kazusa Kyouyama (杏山 カズサ)\n---\n# Kazusa\n",
      "entities/characters/kazusa-kyouyama.md",
    );
    expect(page.name).toBe("Kazusa Kyouyama");
    expect(page.aliases).toEqual(["杏山 カズサ"]);
  });
});
