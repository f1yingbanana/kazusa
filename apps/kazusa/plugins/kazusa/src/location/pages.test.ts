import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readFrontmatter } from "../markdown/frontmatter.ts";
import { PLACE_FRONTMATTER } from "./map.ts";
import {
  removePlacePages,
  renamedText,
  renamePlacePages,
  withoutPlace,
} from "./pages.ts";

const CORRIDOR = `---
place_id: corridor
name: Corridor
parent: annex
summary: "Long and echoing."
connections:
  - to: club
    ways:
      - { by: walk, minutes: 2 }
    note: past the lockers
  - to: library
    ways:
      - { by: walk, minutes: 3 }
---

The [[club|club room]] door is at the end; [[club]] smells of vanilla.
`;

describe("place pages", () => {
  it("renames a place's id, references and links, and nothing else", () => {
    const text = renamedText(`${CORRIDOR}\nThe clubhouse is not the club.\n`, {
      club: "sweets_club",
    });
    const { data } = readFrontmatter(text, PLACE_FRONTMATTER);
    expect(data.connections.map(({ to }) => to)).toEqual([
      "sweets_club",
      "library",
    ]);
    expect(text).toContain("[[sweets_club|club room]]");
    expect(text).toContain("[[sweets_club]] smells");
    expect(text).toContain("The clubhouse is not the club.");
    expect(
      renamedText("---\nplace_id: club\nid: entity.place.club\n---\n", {
        club: "sweets_club",
      }),
    ).toBe("---\nplace_id: sweets_club\nid: entity.place.sweets_club\n---\n");
    expect(
      renamedText("connections: [{ to: club, ways: [] }]\n", { club: "x" }),
    ).toContain("{ to: x, ways");
  });

  it("drops a removed place's connection, item and all", () => {
    const text = withoutPlace(CORRIDOR, { id: "club", name: "Club Room" });
    const { data } = readFrontmatter(text, PLACE_FRONTMATTER);
    expect(data.connections).toEqual([
      { to: "library", ways: [{ by: "walk", minutes: 3 }] },
    ]);
    expect(text).not.toContain("past the lockers");
    // Links become plain text.
    expect(text).toContain(
      "The club room door is at the end; Club Room smells",
    );
  });

  it("leaves an empty list, not null, when the last connection goes", () => {
    const text = withoutPlace(
      `---\nplace_id: a\nname: A\nsummary: "A."\nconnections:\n  - { to: b, ways: [{ by: walk, minutes: 1 }] }\n---\n`,
      { id: "b", name: "B" },
    );
    expect(readFrontmatter(text, PLACE_FRONTMATTER).data.connections).toEqual(
      [],
    );
    expect(text).toContain("connections: []");
  });

  it("moves what was in it, and homes there, up to its area", () => {
    const removed = { id: "annex", name: "Annex", parent: "school" };
    expect(withoutPlace(CORRIDOR, removed)).toContain("parent: school");
    expect(withoutPlace("---\nhome: annex\n---\n", removed)).toBe(
      "---\nhome: school\n---\n",
    );
    // A top-level place: what was in it is at top level, a home stays named.
    const top = { id: "annex", name: "Annex" };
    expect(withoutPlace(CORRIDOR, top)).not.toContain("parent:");
    expect(withoutPlace("---\nhome: annex\n---\n", top)).toBe(
      "---\nhome: annex\n---\n",
    );
  });
});

describe("place page files", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true });
  });
  const wiki = (pages: Record<string, string>) => {
    const dir = mkdtempSync(path.join(tmpdir(), "kazusa-pages-"));
    roots.push(dir);
    for (const [file, text] of Object.entries(pages)) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), text);
    }
    return dir;
  };
  const page = (id: string, extra = "") =>
    `---\nplace_id: ${id}\nname: ${id}\nsummary: "${id}."\n${extra}---\n`;

  it("removes only the page asked for when two say the same id", () => {
    const dir = wiki({
      "entities/places/club.md": page("club"),
      "entities/places/club_copy.md": page("club"),
      "entities/places/hall.md": page("hall", "parent: club\n"),
    });
    const removed = removePlacePages({
      wikiDir: dir,
      id: "club",
      file: path.join(dir, "entities/places/club_copy.md"),
      trashDir: path.join(dir, ".trash"),
      cwd: dir,
    });
    expect(removed.changed).toEqual([]);
    expect(existsSync(path.join(dir, "entities/places/club.md"))).toBe(true);
    expect(
      readFileSync(path.join(dir, "entities/places/hall.md"), "utf8"),
    ).toContain("parent: club");
  });

  it("won't rename onto an id another page has", () => {
    const dir = wiki({
      "entities/places/club.md": page("club"),
      "concepts/sweets.md": "---\nname: Sweets\n---\n",
    });
    expect(() =>
      renamePlacePages({
        wikiDir: dir,
        workspaces: [],
        from: "club",
        to: "sweets",
        cwd: dir,
      }),
    ).toThrow("already a page called sweets");
    expect(() =>
      renamePlacePages({
        wikiDir: dir,
        workspaces: [],
        from: "club",
        to: "Not An Id",
        cwd: dir,
      }),
    ).toThrow("can't be a place id");
    expect(existsSync(path.join(dir, "entities/places/club.md"))).toBe(true);
  });
});
