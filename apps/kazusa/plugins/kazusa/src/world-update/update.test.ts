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
import {
  applyUpdate,
  areaOf,
  finishUpdate,
  planUpdate,
  readReport,
  undoUpdate,
  writeSnapshot,
} from "./update.ts";

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
  put(live, "package.json", pkg({ version: "1.0.0" }, { template: "demo" }));
  writeSnapshot(live, v1, "demo");
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
  return { live, v2 };
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "world-update-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("world update", () => {
  it("merges a new template version and keeps what play wrote", () => {
    const { live, v2 } = setup();
    const plan = planUpdate(live, v2, { layout: "keep" });
    expect(plan.hasBase).toBe(true);
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
    applyUpdate(live, v2, plan, "keep");

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
      kazusa: { template: "demo", renames: { old_market: "market" } },
    });
    expect(readReport(live)?.conflicts).toEqual([]);
  });

  it("finishing makes the new version the base, so nothing is left to do", () => {
    const { live, v2 } = setup();
    applyUpdate(live, v2, planUpdate(live, v2, { layout: "keep" }), "keep");
    finishUpdate(live, v2, "demo");
    expect(planUpdate(live, v2, { layout: "keep" }).changes).toEqual([]);
  });

  it("undo puts every file back", () => {
    const { live, v2 } = setup();
    const before = get(live, "shared/wiki/entities/places/hub.md");
    applyUpdate(live, v2, planUpdate(live, v2, { layout: "keep" }), "keep");
    undoUpdate(live);
    expect(get(live, "shared/wiki/entities/places/hub.md")).toBe(before);
    expect(
      existsSync(path.join(live, "shared/wiki/entities/places/gone.md")),
    ).toBe(true);
    expect(readReport(live)).toBeUndefined();
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
    const plan = planUpdate(live, v2, { layout: "keep" });
    const hub = plan.changes.find(({ path: file }) => file.endsWith("hub.md"));
    expect(hub?.outcome).toBe("conflict");
    expect(hub?.conflicts?.map(({ part }) => part)).toContain("lead");
  });

  it("renames only places, never a concept that shared the id", () => {
    const { live, v2 } = setup();
    for (const dir of [live, v2])
      put(
        dir,
        "shared/wiki/concepts/old_market.md",
        "---\ntitle: Old Market\n---\n\n# Old Market\n",
      );
    const plan = planUpdate(live, v2, { layout: "keep" });
    applyUpdate(live, v2, plan, "keep");
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
    const plan = planUpdate(live, v2, { layout: "keep" });
    const outcome = (file: string) =>
      plan.changes.find(({ path: p }) => p.endsWith(file))?.outcome;
    expect(outcome("amy/wiki/entities/places/gone.md")).toBe("orphaned");
    expect(outcome("places/hub_stub.md")).toBe("forgotten");
    applyUpdate(live, v2, plan, "keep");
    expect(get(live, "workspaces/amy/wiki/entities/places/gone.md")).toContain(
      "Where I met Bea.",
    );
    expect(readReport(live)?.orphaned[0]?.reason).toBe(
      "its place no longer exists",
    );
  });

  it("without a base, takes the creator's version only where play left no mark", () => {
    const { live, v2 } = setup();
    rmSync(path.join(live, ".template"), { recursive: true, force: true });
    put(
      v2,
      "workspaces/amy/wiki/entities/places/hub.md",
      "---\nplace_id: hub\nname: hub\n---\n\nThe centre of town.\n",
    );
    put(
      live,
      "workspaces/amy/wiki/entities/places/hub.md",
      "---\nplace_id: hub\nname: hub\n---\n\nA place.\n",
    );
    put(
      v2,
      "workspaces/amy/wiki/entities/places/market.md",
      "---\nplace_id: market\nname: market\n---\n\nNew words.\n",
    );
    const plan = planUpdate(live, v2, { layout: "keep" });
    expect(plan.bestAttempt).toBe(true);
    const outcome = (file: string) =>
      plan.changes.find(({ path: p }) => p === file)?.outcome;
    // Untouched by play: the creator's.
    expect(outcome("workspaces/amy/wiki/entities/places/hub.md")).toBe(
      "updated",
    );
    // Stamped by a visit: her words stay, and it is asked about.
    expect(outcome("workspaces/amy/wiki/entities/places/market.md")).toBe(
      "conflict",
    );
    expect(plan.notInTemplate).toContain("shared/wiki/entities/places/gone.md");
  });
});

describe("pending renames", () => {
  it("lists only the renames this world hasn't taken yet", () => {
    const { live, v2 } = setup();
    applyUpdate(live, v2, planUpdate(live, v2, { layout: "keep" }), "keep");
    finishUpdate(live, v2, "demo");
    const again = planUpdate(live, v2, { layout: "keep" });
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
    put(live, "package.json", pkg({ version: "1.0.0" }, { template: "demo" }));
    put(live, "shared/wiki/entities/places/park.md", place("park", at(0.3)));
    writeSnapshot(live, v1, "demo");
    put(live, "shared/wiki/entities/places/hub.md", place("hub", at(0.1)));
    put(v2, "package.json", pkg({ version: "2.0.0" }));
    put(v2, "shared/wiki/entities/places/hub.md", place("hub", at(0.9)));
    put(v2, "shared/wiki/entities/places/park.md", place("park", at(0.7)));
    const plan = planUpdate(live, v2, { layout: "keep" });
    expect(plan.arranged).toBe(1);
    expect(plan.arrangedMoved).toBe(1);
    applyUpdate(live, v2, plan, "keep");
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
