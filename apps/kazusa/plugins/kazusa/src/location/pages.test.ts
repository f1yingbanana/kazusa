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
  renameCards,
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

describe("a place called something new", () => {
  it("gives each character's card for it the new name, and nothing else", () => {
    const root = mkdtempSync(path.join(tmpdir(), "kazusa-cards-"));
    try {
      const card = path.join(root, "amy", "wiki", "concepts", "club.md");
      mkdirSync(path.dirname(card), { recursive: true });
      writeFileSync(
        card,
        "---\nplace_id: club\nname: Club Room\n---\n\nname: not this line.\n",
      );
      const changed = renameCards({
        workspaces: [path.join(root, "amy"), path.join(root, "bea")],
        id: "club",
        name: "Sweets Club Room",
        cwd: root,
      });
      expect(changed).toEqual(["amy/wiki/concepts/club.md"]);
      expect(readFileSync(card, "utf8")).toBe(
        '---\nplace_id: club\nname: "Sweets Club Room"\n---\n\nname: not this line.\n',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("renaming a place that is also a group", () => {
  it("carries who is in it and who knows through it", () => {
    const text =
      "---\nname: Amy\nhome: club\nin:\n  club: close\n  trinity: knows\nknown: { club: knows, everyone: heard of }\n---\n\nIn the [[club]].\n";
    expect(renamedText(text, { club: "sweets_club" })).toBe(
      "---\nname: Amy\nhome: sweets_club\nin:\n  sweets_club: close\n  trinity: knows\nknown: { sweets_club: knows, everyone: heard of }\n---\n\nIn the [[sweets_club]].\n",
    );
  });
});

describe("a place saved as no place any more", () => {
  it("keeps its page and links, and mends the map around it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kazusa-unplace-"));
    try {
      const write = (file: string, text: string) => {
        mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        writeFileSync(path.join(dir, file), text);
      };
      write(
        "concepts/annex.md",
        "---\nplace_id: annex\nname: Annex\n---\n\n# Annex\n",
      );
      write(
        "concepts/club.md",
        "---\nplace_id: club\nname: Club\nparent: annex\n---\n\n# Club\n",
      );
      write(
        "concepts/hall.md",
        "---\nplace_id: hall\nname: Hall\nconnections:\n  - { to: club, ways: [{ by: walk, minutes: 2 }] }\n---\n\nNext to the [[club]].\n",
      );
      write("characters/amy.md", "---\nname: Amy\nhome: club\n---\n\n# Amy\n");
      const keepAs = "---\nname: Club\ngroup: true\n---\n\n# Club\n";
      removePlacePages({
        wikiDir: dir,
        id: "club",
        file: path.join(dir, "concepts/club.md"),
        keepAs,
        cwd: dir,
      });
      expect(readFileSync(path.join(dir, "concepts/club.md"), "utf8")).toBe(
        keepAs,
      );
      const hall = readFileSync(path.join(dir, "concepts/hall.md"), "utf8");
      expect(hall).toContain("[[club]]");
      expect(hall).not.toContain("to: club");
      expect(
        readFileSync(path.join(dir, "characters/amy.md"), "utf8"),
      ).toContain("home: annex");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
