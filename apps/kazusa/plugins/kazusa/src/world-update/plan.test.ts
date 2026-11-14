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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyUpdate, openReport, readReport } from "./apply.ts";
import { areaOf, planUpdate } from "./plan.ts";
import { blobId, folderTree } from "./tree.ts";

let root: string;
const put = (dir: string, file: string, text: string) => {
  const full = path.join(dir, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text);
};
const get = (dir: string, file: string) =>
  readFileSync(path.join(dir, file), "utf8");
const place = (id: string, extra = "") =>
  `---\nplace_id: ${id}\nname: ${id}\nsummary: A place.${extra}\n---\n\n# ${id}\n`;

/** A world's `package.json`. */
const pkg = (fields: object, kazusa: object = {}) =>
  JSON.stringify({
    name: "demo",
    ...fields,
    kazusa: { systemAgent: "amy", ...kazusa },
  });

/** A template at version 1, a live world copied from it, and version 2. */
function setup() {
  const v1 = path.join(root, "v1");
  const live = path.join(root, "world");
  const v2 = path.join(root, "worlds", "demo");
  for (const dir of [v1, live]) {
    put(dir, "package.json", pkg({ version: "1.0.0" }));
    put(dir, "shared/wiki/entities/places/hub.md", place("hub"));
    put(
      dir,
      "shared/wiki/entities/places/old_market.md",
      place("old_market", "\nparent: hub"),
    );
    put(
      dir,
      "shared/wiki/entities/places/gone.md",
      place("gone", "\nparent: hub"),
    );
    put(
      dir,
      "workspaces/amy/MEMORY.md",
      "# Amy\n\n## Long-Term Goals\n\n- Win.\n",
    );
    put(
      dir,
      "workspaces/amy/wiki/entities/places/old_market.md",
      "---\nplace_id: old_market\nname: old_market\nlearned: always known\n---\n\nI shop here.\n",
    );
    put(
      dir,
      "workspaces/amy/wiki/entities/places/gone.md",
      "---\nplace_id: gone\nname: gone\n---\n\nFiller.\n",
    );
  }
  put(live, "package.json", pkg({ version: "1.0.0" }));
  // Play: a note on a card, a layout, a new page, a sleep section.
  put(
    live,
    "workspaces/amy/wiki/entities/places/old_market.md",
    "---\nplace_id: old_market\nname: old_market\nlearned: always known\nseen: 2026-11-01\n---\n\nI shop here.\n",
  );
  put(
    live,
    "shared/wiki/entities/places/hub.md",
    place("hub", "\nmap: { x: 0.5, y: 0.5 }"),
  );
  put(
    live,
    "workspaces/amy/wiki/entities/characters/bea.md",
    "---\nname: Bea\n---\n\nA friend.\n",
  );
  put(
    live,
    "workspaces/amy/MEMORY.md",
    "# Amy\n\n## Long-Term Goals\n\n- Win.\n\n## Lately\n\nBusy.\n",
  );
  // Version 2: a rename, a removal, a rewrite and a new section.
  put(
    v2,
    "package.json",
    pkg({ version: "2.0.0" }, { renames: { old_market: "market" } }),
  );
  put(
    v2,
    "shared/wiki/entities/places/hub.md",
    place("hub").replace("A place.", "The centre."),
  );
  put(
    v2,
    "shared/wiki/entities/places/market.md",
    place("market", "\nparent: hub"),
  );
  put(
    v2,
    "workspaces/amy/MEMORY.md",
    "# Amy\n\n## Long-Term Goals\n\n- Win.\n\n## My usual week\n\n- Shopping.\n",
  );
  put(
    v2,
    "workspaces/amy/wiki/entities/places/market.md",
    "---\nplace_id: market\nname: market\nlearned: always known\n---\n\nI shop here, still.\n",
  );
  return { live, v1, v2 };
}

/** Plans the update from `v1` (the base) to `v2`, both folders. */
const planOf = (live: string, v2: string, v1 = path.join(root, "v1")) =>
  planUpdate(live, folderTree(v2), folderTree(v1), { layout: "keep" });
const apply = (
  live: string,
  v2: string,
  planned: ReturnType<typeof planOf>,
) => {
  openReport(live, planned, "keep", {
    from: "v1",
    to: "v2",
    version: "2.0.0",
    save: "refs/saves/before-update-2.0.0",
  });
  applyUpdate(live, folderTree(v2), planned);
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "world-update-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("world update", () => {
  it("merges a new template version and keeps what play wrote", () => {
    const { live, v2 } = setup();
    const plan = planOf(live, v2);
    expect(plan.pendingRenames).toEqual({ old_market: "market" });
    expect(plan.areas[0]).toMatchObject({
      area: "shared/wiki/entities/places",
    });
    expect(
      plan.areas.find(({ area }) => area === "workspaces/*/MEMORY.md"),
    ).toEqual({
      area: "workspaces/*/MEMORY.md",
      counts: { merged: 1 },
      characters: 1,
    });
    apply(live, v2, plan);

    const hub = get(live, "shared/wiki/entities/places/hub.md");
    expect(hub).toContain("The centre.");
    expect(hub).toContain("map: { x: 0.5, y: 0.5 }");
    expect(
      existsSync(path.join(live, "shared/wiki/entities/places/gone.md")),
    ).toBe(false);
    expect(
      existsSync(path.join(live, "shared/wiki/entities/places/old_market.md")),
    ).toBe(false);

    const card = get(live, "workspaces/amy/wiki/entities/places/market.md");
    expect(card).toContain("place_id: market");
    expect(card).toContain("seen: 2026-11-01");
    expect(card).toContain("I shop here, still.");
    expect(
      existsSync(
        path.join(live, "workspaces/amy/wiki/entities/places/gone.md"),
      ),
    ).toBe(false);
    expect(
      existsSync(
        path.join(live, "workspaces/amy/wiki/entities/characters/bea.md"),
      ),
    ).toBe(true);

    const memory = get(live, "workspaces/amy/MEMORY.md");
    expect(memory).toContain("## Lately");
    expect(memory).toContain("## My usual week");
    expect(JSON.parse(get(live, "package.json"))).toMatchObject({
      version: "2.0.0",
      kazusa: { renames: { old_market: "market" } },
    });
    expect(readReport(live)?.conflicts).toEqual([]);
  });

  it("with the new version as the base, nothing is left to do", () => {
    const { live, v2 } = setup();
    apply(live, v2, planOf(live, v2));
    expect(planOf(live, v2, v2).changes).toEqual([]);
  });

  it("reports a page both sides rewrote and keeps the live text", () => {
    const { live, v2 } = setup();
    put(
      live,
      "shared/wiki/entities/places/hub.md",
      place("hub").replace("# hub", "# hub\n\nThe user's own words."),
    );
    put(
      v2,
      "shared/wiki/entities/places/hub.md",
      place("hub").replace("# hub", "# hub\n\nThe creator's words."),
    );
    const plan = planOf(live, v2);
    const hub = plan.changes.find(({ path: file }) => file.endsWith("hub.md"));
    expect(hub?.outcome).toBe("conflict");
    expect(hub?.conflicts?.map(({ part }) => part)).toContain("lead");
    // The report remembers the file as `apply` left it, so a resolution shows.
    apply(live, v2, plan);
    const file = path.join(live, "shared/wiki/entities/places/hub.md");
    const [conflict] = readReport(live)!.conflicts;
    expect(conflict?.written).toBe(blobId(readFileSync(file)));
  });

  it("renames only places, never a concept that shared the id", () => {
    const { live, v2 } = setup();
    for (const dir of [live, v2])
      put(
        dir,
        "shared/wiki/concepts/old_market.md",
        "---\ntitle: Old Market\n---\n\n# Old Market\n",
      );
    const plan = planOf(live, v2);
    apply(live, v2, plan);
    expect(
      existsSync(path.join(live, "shared/wiki/concepts/old_market.md")),
    ).toBe(true);
    expect(existsSync(path.join(live, "shared/wiki/concepts/market.md"))).toBe(
      false,
    );
  });

  it("keeps a card in the character's own words when its place is gone", () => {
    const { live, v2 } = setup();
    put(
      live,
      "workspaces/amy/wiki/entities/places/gone.md",
      "---\nplace_id: gone\nname: gone\n---\n\nWhere I met Bea.\n",
    );
    put(
      live,
      "workspaces/amy/wiki/entities/places/hub_stub.md",
      "---\nplace_id: hub_stub\nname: hub_stub\nseen: 2026-11-01\n---\n",
    );
    const plan = planOf(live, v2);
    const outcome = (file: string) =>
      plan.changes.find(({ path: p }) => p.endsWith(file))?.outcome;
    expect(outcome("amy/wiki/entities/places/gone.md")).toBe("orphaned");
    expect(outcome("places/hub_stub.md")).toBe("forgotten");
    apply(live, v2, plan);
    expect(get(live, "workspaces/amy/wiki/entities/places/gone.md")).toContain(
      "Where I met Bea.",
    );
    expect(readReport(live)?.orphaned[0]?.reason).toBe(
      "its place no longer exists",
    );
  });
});

describe("renamed places", () => {
  it("gives a card only play has the renamed place's id and its world name", () => {
    const { live, v2 } = setup();
    put(
      v2,
      "shared/wiki/entities/places/market.md",
      place("market", "\nparent: hub").replace(
        "name: market",
        "name: The Market",
      ),
    );
    put(
      live,
      "workspaces/bea/wiki/entities/places/old_market.md",
      "---\nplace_id: old_market\nname: Old Market\n---\n\nWhere I met Amy.\n",
    );
    const change = planOf(live, v2).changes.find(
      ({ path: file }) =>
        file === "workspaces/bea/wiki/entities/places/market.md",
    );
    expect(change).toMatchObject({
      outcome: "updated",
      from: "workspaces/bea/wiki/entities/places/old_market.md",
    });
    expect(change?.text).toContain("place_id: market\nname: The Market\n");
    expect(change?.text).toContain("Where I met Amy.");
  });
});

describe("pending renames", () => {
  it("lists only the renames this world hasn't taken yet", () => {
    const { live, v2 } = setup();
    apply(live, v2, planOf(live, v2));
    const again = planOf(live, v2, v2);
    expect(again.renames).toEqual({ old_market: "market" });
    expect(again.pendingRenames).toEqual({});
  });
});

describe("arranged places", () => {
  it("asks about a position both the user and the creator moved, and follows the creator's elsewhere", () => {
    const v1 = path.join(root, "v1");
    const live = path.join(root, "world");
    const v2 = path.join(root, "worlds", "demo");
    const at = (x: number) => `\nmap: { x: ${x}, y: ${x} }`;
    for (const dir of [v1, live])
      put(dir, "package.json", pkg({ version: "1.0.0" }));
    put(v1, "shared/wiki/entities/places/hub.md", place("hub", at(0.5)));
    put(v1, "shared/wiki/entities/places/park.md", place("park", at(0.3)));
    put(live, "package.json", pkg({ version: "1.0.0" }));
    put(live, "shared/wiki/entities/places/park.md", place("park", at(0.3)));
    put(live, "shared/wiki/entities/places/hub.md", place("hub", at(0.1)));
    put(v2, "package.json", pkg({ version: "2.0.0" }));
    put(v2, "shared/wiki/entities/places/hub.md", place("hub", at(0.9)));
    put(v2, "shared/wiki/entities/places/park.md", place("park", at(0.7)));
    const plan = planOf(live, v2);
    expect(plan.arranged).toBe(1);
    expect(plan.arrangedMoved).toBe(1);
    apply(live, v2, plan);
    expect(get(live, "shared/wiki/entities/places/hub.md")).toContain("x: 0.1");
    expect(get(live, "shared/wiki/entities/places/park.md")).toContain(
      "x: 0.7",
    );
  });
});

describe("areaOf", () => {
  it("names a file's kind, with a character's id as a star", () => {
    expect(areaOf("shared/backdrops/gym/day.webp")).toEqual({
      area: "shared/backdrops",
    });
    expect(areaOf("workspaces/ami/portraits/happy.webp")).toEqual({
      area: "workspaces/*/portraits",
      character: "ami",
    });
    expect(areaOf("shared/wiki/entities/places/gym.md").area).toBe(
      "shared/wiki/entities/places",
    );
    expect(areaOf("workspaces/ami/wiki/days/2026-11-02.md").area).toBe(
      "workspaces/*/wiki/days",
    );
    expect(areaOf("workspaces/ami/SOUL.md").area).toBe("workspaces/*/SOUL.md");
    expect(areaOf("package.json").area).toBe("package.json");
  });
});
