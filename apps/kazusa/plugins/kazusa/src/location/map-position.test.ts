import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parsePlace } from "./map.ts";
import { withPosition, writePositions } from "./map-position.ts";

const page = (map?: string) => `---
pageType: entity
place_id: dock
name: "The Dock"   # kept as written
summary:
  "Long summary that wraps
  across lines."
${map ?? ""}
connections:
  - to: square
    ways:
      - { by: walk, minutes: 8 }
---

# The Dock

map: this line in the body is prose.
`;

describe("withPosition", () => {
  it("adds a position and leaves everything else byte for byte", () => {
    const before = page().replace("\n\nconnections", "\nconnections");
    const after = withPosition(before, { x: 0.25, y: 0.5 });
    expect(parsePlace(after).map).toEqual({ x: 0.25, y: 0.5 });
    expect(after.replace("map: { x: 0.25, y: 0.5 }\n", "")).toBe(before);
    expect(after).toContain('name: "The Dock"   # kept as written');
  });

  it("replaces a flow value and keeps its plane", () => {
    const after = withPosition(page("map: { plane: shadow, x: 0.1, y: 0.2 }"), {
      x: 0.3,
      y: 0.4,
    });
    expect(after).toContain("map: { plane: shadow, x: 0.3, y: 0.4 }");
    expect(after).not.toContain("0.1");
    expect(parsePlace(after).map).toEqual({ plane: "shadow", x: 0.3, y: 0.4 });
  });

  it("replaces a block value without touching the next key", () => {
    const after = withPosition(page("map:\n  x: 0.1\n  y: 0.2"), {
      x: 1,
      y: 2,
    });
    expect(after).toContain("map: { x: 1, y: 2 }\nconnections:");
    expect(parsePlace(after).connections).toHaveLength(1);
  });

  it("never touches the body", () => {
    const after = withPosition(page("map: { x: 0, y: 0 }"), { x: 1, y: 1 });
    expect(after).toContain("map: this line in the body is prose.");
  });

  it("keeps Windows line endings", () => {
    const after = withPosition(
      page("map: { x: 0, y: 0 }").replace(/\n/gu, "\r\n"),
      {
        x: 1,
        y: 1,
      },
    );
    expect(after).toContain("map: { x: 1, y: 1 }\r\n");
    expect(after.replace(/\r\n/gu, "")).not.toContain("\n");
    expect(parsePlace(after).map).toEqual({ x: 1, y: 1 });
  });
});

describe("parsePlace map", () => {
  it("ignores a broken position rather than failing the world", () => {
    expect(parsePlace(page('map: { x: "far" }')).map).toBeUndefined();
  });
});

describe("writePositions", () => {
  let wikiDir: string;

  beforeEach(async () => {
    wikiDir = await mkdtemp(path.join(tmpdir(), "map-position-"));
    await mkdir(path.join(wikiDir, "entities", "places"), { recursive: true });
  });
  afterEach(() => rm(wikiDir, { recursive: true, force: true }));

  it("writes only named places, by place_id, leaving no temporary files", async () => {
    const dir = path.join(wikiDir, "entities", "places");
    // The file name doesn't have to match the id.
    await writeFile(path.join(dir, "harbour.md"), page());
    const other = page().replace("place_id: dock", "place_id: square");
    await writeFile(path.join(dir, "square.md"), other);

    const written = await writePositions(wikiDir, {
      dock: { x: 0.5, y: 0.5 },
      gone: { x: 1, y: 1 },
    });

    expect(written).toBe(1);
    expect(await readFile(path.join(dir, "square.md"), "utf8")).toBe(other);
    expect(
      parsePlace(await readFile(path.join(dir, "harbour.md"), "utf8")).map,
    ).toEqual({ x: 0.5, y: 0.5 });
    expect((await readdir(dir)).sort()).toEqual(["harbour.md", "square.md"]);
  });
});
