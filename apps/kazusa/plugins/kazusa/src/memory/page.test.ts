import { describe, expect, it } from "vitest";
import { parsePage } from "./page.ts";

describe("parsePage", () => {
  it("reads a world page in layers", () => {
    const page = parsePage(
      `---
summary: Feared and overworked.
aliases: [Prefects]
known: { everyone: heard of, gehenna_academy: knows }
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
      known: [{ ref: "gehenna_academy", level: "knows" }],
      everyone: "heard of",
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

  it("reads a `Known by:` list wrapped onto the next lines", () => {
    const page = parsePage(
      `# Gate\n\n## Secret\n\nKnown by: fia,\nbrother-corhyn\n\nThe key is under the stone.\n`,
      "concepts/gate.md",
    );
    expect(page.sections).toEqual([
      {
        title: "Secret",
        text: "The key is under the stone.",
        knownBy: ["fia", "brother-corhyn"],
      },
    ]);
  });

  it("reads a note or thread wrapped onto the next lines as one", () => {
    const page = parsePage(
      `---
name: Natsu
---

Milk.

## Open threads

- Ask about the carton she
  promised me.

## Notes

- 2026-10-22 · seen it · sure — Spilled milk on her notes and
  kept talking anyway.
`,
      "entities/characters/natsu.md",
    );
    expect(page.openThreads).toEqual(["Ask about the carton she promised me."]);
    expect(page.notes.map(({ text }) => text)).toEqual([
      "Spilled milk on her notes and kept talking anyway.",
    ]);
    expect(page.problems).toEqual([]);
  });

  it("falls back to the lead's first sentence and the H1 name", () => {
    const page = parsePage(
      "# Angel 24\n\nOpen all night. Bright.\n",
      "entities/places/angel_24.md",
    );
    // In a world not yet upgraded, its folder makes it a place.
    expect(page).toMatchObject({
      kind: "concept",
      place: true,
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

  it("reads `known` and `in` as a list, or with how well each knows them", () => {
    const list = parsePage(
      "---\nin: [Seminar, Millennium]\n---\n# Yuuka\n",
      "characters/yuuka.md",
    );
    expect(list.in).toEqual([
      { ref: "Seminar", level: "knows" },
      { ref: "Millennium", level: "knows" },
    ]);
    const map = parsePage(
      "---\nin: { Seminar: close, Millennium: knows }\nknown: { everyone: heard of, Gehenna: heard of }\n---\n# Yuuka\n",
      "characters/yuuka.md",
    );
    expect(map.in).toEqual([
      { ref: "Seminar", level: "close" },
      { ref: "Millennium", level: "knows" },
    ]);
    expect(map.known).toEqual([{ ref: "Gehenna", level: "heard of" }]);
    expect(map.everyone).toBe("heard of");
  });

  it("reads its components and its links by who can see them", () => {
    const page = parsePage(
      "---\nplace_id: gehenna\ngroup: true\nsummary: A school, rival of [[trinity]].\n---\n# Gehenna\n\nRun by [[pandemonium]].\n\n## Inside\n\nThe [[prefects]] patrol.\n\n## Voice\n\nKnown by: gehenna\n\nA [[secret]].\n",
      "concepts/gehenna.md",
    );
    expect([page.kind, page.place, page.group]).toEqual([
      "concept",
      true,
      true,
    ]);
    expect(page.linksAt).toEqual({
      heard: ["trinity"],
      knows: ["pandemonium"],
      close: ["prefects"],
    });
  });
});

describe("levels in the editor's words", () => {
  it("read as the levels they stand for", () => {
    const page = parsePage(
      "---\nname: Amy\nhome: room\nin: { choir: associate, club: close member, school: member }\n---\n# Amy\n",
      "characters/amy.md",
    );
    expect(page.problems).toEqual([]);
    expect(page.home).toBe("room");
    expect(page.in).toEqual([
      { ref: "choir", level: "heard of" },
      { ref: "club", level: "close" },
      { ref: "school", level: "knows" },
    ]);
  });
});

describe("a History written as prose", () => {
  it("is an ordinary section, not lost", () => {
    const page = parsePage(
      "---\nname: Trinity\n---\n# Trinity\n\nA school.\n\n## History\n\nFounded long ago by three factions.\n",
      "concepts/trinity.md",
    );
    expect(page.problems).toEqual([]);
    expect(page.history).toEqual([]);
    expect(page.sections).toContainEqual(
      expect.objectContaining({
        title: "History",
        text: expect.stringContaining("three factions"),
      }),
    );
  });
});
