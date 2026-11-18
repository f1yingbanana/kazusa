import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { convertPage } from "./one-page.mjs";
import { foldCharacterCards } from "./plugin-startup.mjs";

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

describe("folding old cards before the Gateway starts", () => {
  function world() {
    const root = mkdtempSync(path.join(tmpdir(), "kazusa-one-page-"));
    const dir = path.join(root, "apps/kazusa/world");
    const put = (relative, text) => {
      mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
      writeFileSync(path.join(dir, relative), text);
    };
    put(
      "openclaw.json",
      JSON.stringify({
        agents: { defaults: { systemAgent: { agentId: "arona" } } },
      }),
    );
    put("shared/wiki/entities/characters/yuuka.md", PAGE);
    put("workspaces/yuuka/IDENTITY.md", IDENTITY);
    put("workspaces/yuuka/SOUL.md", SOUL);
    put("workspaces/yuuka/MEMORY.md", "Plans.");
    put("workspaces/arona/SOUL.md", "ARONA's own.");
    return { root, dir };
  }

  it("folds them in once, keeping every original", () => {
    const { root, dir } = world();
    const [line] = foldCharacterCards(root);
    expect(line).toMatch(/^1 characters are one page now/);
    const page = readFileSync(
      path.join(dir, "shared/wiki/entities/characters/yuuka.md"),
      "utf8",
    );
    expect(page).toContain("## Inner voice");
    // Cards are set aside, the system agent's kept, MEMORY.md untouched.
    expect(existsSync(path.join(dir, "workspaces/yuuka/SOUL.md"))).toBe(false);
    expect(existsSync(path.join(dir, "workspaces/arona/SOUL.md"))).toBe(true);
    expect(existsSync(path.join(dir, "workspaces/yuuka/MEMORY.md"))).toBe(true);
    const kept = path.join(dir, ".state/kazusa/one-page");
    const [run] = readdirSync(kept);
    expect(
      readFileSync(
        path.join(kept, run, "shared/wiki/entities/characters/yuuka.md"),
        "utf8",
      ),
    ).toBe(PAGE);
    expect(
      readFileSync(path.join(kept, run, "workspaces/yuuka/SOUL.md"), "utf8"),
    ).toBe(SOUL);
    // Nothing left to fold: the next start does nothing.
    expect(foldCharacterCards(root)).toEqual([]);
  });
});
