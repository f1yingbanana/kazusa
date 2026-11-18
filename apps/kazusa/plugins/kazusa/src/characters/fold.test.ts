import { describe, expect, it } from "vitest";
import { convertPage } from "./fold.ts";

const PAGE = `---
pageType: entity
character_id: yuuka
name: Yuuka
school: Millennium
club: Seminar
home: room_yuuka
year: 2nd
---

# Yuuka

The treasurer.
  A wrapped line kept as it was.

## Rumours

People say she never sleeps.
`;

const IDENTITY = `---
agent_id: yuuka
name: Yuuka
---

# Yuuka

The treasurer.

## Appearance

Navy hair.

## Rumours

A different rumour section.
`;

const SOUL = `# Yuuka

Stern, secretly kind.

## Voice

Short sentences.
`;

describe("one page per character", () => {
  it("keeps the page's own text byte for byte, adding the card after it", () => {
    const after = convertPage(PAGE, "person", "yuuka", {
      identity: IDENTITY,
      soul: SOUL,
    });
    const body = PAGE.slice(PAGE.indexOf("# Yuuka"));
    expect(after).toContain(body.trimEnd());
    expect(after).toContain("## Appearance\n\nNavy hair.");
    // The card's twin of a page section comes after it, renamed, not lost.
    expect(after).toContain("## Rumours (2)\n\nA different rumour section.");
    expect(after).toContain(
      "## Inner voice\n\nKnown by: yuuka\n\nStern, secretly kind.",
    );
    expect(after).toContain("## Voice\n\nKnown by: yuuka\n\nShort sentences.");
    expect(after).toContain("## Details\n\n- Year: 2nd");
    expect(after).toContain(
      "groups:\n  Seminar: close\n  Millennium: member\n",
    );
    expect(after).not.toMatch(/school:|club:|pageType|character_id/);
  });

  it("adds nothing twice when folded again", () => {
    const card = { identity: IDENTITY, soul: SOUL };
    const once = convertPage(PAGE, "person", "yuuka", card);
    const twice = convertPage(once, "person", "yuuka", card);
    expect(twice).toBe(once);
  });

  it("leaves a page that needs nothing exactly as it is", () => {
    const page =
      "---\nname: Noa\ngroups: [Seminar]\n---\n\n# Noa\n\nKeeps the minutes.\n";
    expect(convertPage(page, "person", "noa", {})).toBe(page);
  });
});
