import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Stimulus } from "../stimulus.ts";
import { registerDirector } from "./register.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

function memoryStore<T>() {
  const values = new Map<string, T>();
  return {
    lookup: async (key: string) => values.get(key),
    register: async (key: string, value: T) => {
      values.set(key, value);
    },
  };
}

type Tool = {
  name: string;
  execute: (
    id: string,
    params: Record<string, unknown>,
  ) => Promise<{ content: { text: string }[] }>;
};

function setup(notebook: string, seen: readonly boolean[] = []) {
  const root = mkdtempSync(path.join(os.tmpdir(), "director-"));
  roots.push(root);
  const director = path.join(root, "boss");
  mkdirSync(path.join(director, ".agents/skills/world-director"), {
    recursive: true,
  });
  writeFileSync(path.join(director, "MEMORY.md"), notebook);
  writeFileSync(
    path.join(director, ".agents/skills/world-director/SKILL.md"),
    "---\nname: world-director\n---\n\n# Directing\n\nHold the line.\n",
  );
  const config = {
    agents: {
      defaults: { systemAgent: { agentId: "boss" } },
      entries: { boss: {}, ann: {}, ben: {} },
    },
  };
  const tools: Tool[] = [];
  const api = {
    config,
    logger: { info: vi.fn(), warn: vi.fn() },
    registerTool: (tool: Tool) => tools.push(tool),
    runtime: {
      config: { current: () => config },
      agent: {
        resolveAgentWorkspaceDir: (_config: unknown, id: string) =>
          path.join(root, id),
        resolveAgentIdentity: (_config: unknown, id: string) => ({
          name: id.toUpperCase(),
        }),
      },
      state: { openKeyedStore: () => memoryStore() },
    },
  } as unknown as OpenClawPluginApi;
  const received: [string, Stimulus][] = [];
  const narrated: string[] = [];
  const evaluate = vi.fn(async () => ({
    status: "ok" as const,
    result: {
      answers: Object.fromEntries(
        seen.map((yes, at) => [
          `b${at + 1}`,
          { type: "boolean" as const, probabilityTrue: yes ? 0.9 : 0.1 },
        ]),
      ),
    },
  }));
  const complete = vi.fn(
    async (_prompt: string) =>
      "1. Not yet.\n2. Ann gives way.\n3. Give Ann a reason to hold.",
  );
  const service = registerDirector(api, {
    evaluate: evaluate as never,
    complete,
    clock: { time: () => Date.UTC(2026, 0, 1, 17) },
    receive: async (agentId, stimulus) => {
      received.push([agentId, stimulus]);
    },
    huddleOf: async (id) =>
      id === "ann" ? { id: "huddle:a", members: ["ann", "ben"] } : undefined,
    narrate: async (chatId, _narrator, text) => {
      narrated.push(`${chatId}: ${text}`);
      return { members: ["ann", "ben"] };
    },
    placeOf: async () => ({ placeId: "park", title: "The park" }),
    activity: async () => ({ type: "walking", description: "A walk" }),
    latest: async () => ["Ann: hello", "Ben: hi"],
    onstage: async (id) => id !== "ben",
  });
  const narrate = tools.find((tool) => tool.name === "narrate")!;
  const cast = tools.find((tool) => tool.name === "cast")!;
  mkdirSync(path.join(root, "ann"), { recursive: true });
  writeFileSync(
    path.join(root, "ann", "MEMORY.md"),
    "# Ann\n\n## Plans recorded for 2026-01-01\n\n- [SOFT_GOAL] Meet Ben at the park at 18:00\n",
  );
  return {
    cast,
    service,
    received,
    narrated,
    narrate,
    evaluate,
    complete,
  };
}

const WATCHING = [
  "---",
  "watching:",
  "  - who: ann",
  '    for: "Ann asks Ben; until 21:00"',
  "  - who: ben",
  "  - who: ghost",
  "---",
  "# Notes",
].join("\n");

describe("the director", () => {
  it("has its skill in front of it on every turn of its own", async () => {
    const directing = setup(WATCHING);
    expect(await directing.service.guide("boss")).toBe(
      "# Directing\n\nHold the line.",
    );
    expect(await directing.service.guide("ann")).toBeUndefined();
    const arcs = setup("# Notes\n\n## Arcs\n\n### One");
    expect(await arcs.service.guide("boss")).toContain("Hold the line");
    const idle = setup("# Notes");
    expect(await idle.service.guide("boss")).toContain("Hold the line");
    expect(await idle.service.view("boss")).toMatch(/Nobody/);
  });

  it("sees whom it watches as they are now", async () => {
    const { service } = setup(WATCHING);
    const view = await service.view("boss");
    expect(view).toContain("ANN (ann): at The park (park)");
    expect(view).toContain("in conversation with BEN (ben)");
    expect(view).toContain("  > Ben: hi");
    expect(view).toContain("Watching for: Ann asks Ben; until 21:00");
    expect(view).toMatch(/BEN \(ben\): offstage/);
    expect(view).toMatch(/\(ghost\): no character of that id/);
    expect(await service.view("ann")).toBeUndefined();
  });

  it("narrates into a character's conversation, or to them alone", async () => {
    const { narrate, narrated, received } = setup(WATCHING);
    const told = await narrate.execute("1", { who: "ann", text: "Rain." });
    expect(narrated).toEqual(["huddle:a: Rain."]);
    expect(told.content[0]?.text).toMatch(/Narrated to ann, ben/);
    const away = await narrate.execute("2", {
      who: "ben",
      text: "A bell rings.",
    });
    expect(away.content[0]?.text).toMatch(/ben is offstage/);
    expect(received).toEqual([]);
    expect(
      (await narrate.execute("3", { who: "boss", text: "x" })).content[0]?.text,
    ).toMatch(/No character/);
  });

  it("cues the director at most once per character in ten sim minutes", async () => {
    const { service, received } = setup(WATCHING);
    await service.cue("ann", "Ben: let's go");
    await service.cue("ann", "Ben: now");
    await service.cue("nobody", "x");
    expect(received).toHaveLength(1);
    expect(received[0]?.[0]).toBe("boss");
    expect(received[0]?.[1].text).toContain("Ben: let's go");
    expect(received[0]?.[1].text).toContain("Ann asks Ben");
  });

  it("checks promised beats against the page, and says when they are due", async () => {
    const notebook = WATCHING.replace(
      "---\n# Notes",
      "promised:\n  - They argue: raised voices\n  - They make up\n---\n# Notes",
    );
    const { service, evaluate, complete } = setup(notebook, [false, false]);
    let view = await service.view("boss");
    expect(view).toContain(
      "- [ ] They argue: raised voices: not seen on the page; 0 looks",
    );
    await service.look("boss");
    await service.look("boss");
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(evaluate.mock.calls[0])).toContain("Ben: hi");
    view = await service.view("boss");
    expect(view).toContain("2 looks since you promised it");
    expect(view).toMatch(/Climb a rung of the ladder now/);
    expect(view).toContain("Give Ann a reason to hold.");
    expect(String(complete.mock.calls[0]?.[0])).toContain("They make up");
    const seen = setup(notebook, [true, false]);
    await seen.service.cue("ann", "Ben: no!");
    view = await seen.service.view("boss");
    expect(view).toContain(
      "- [x] They argue: raised voices: seen on the page at 17:00",
    );
    expect(view).not.toMatch(/Climb a rung/);
    expect(view).not.toMatch(/Note on the open beats/);
  });

  it("tells an aside to one character only, even mid-conversation", async () => {
    const { narrate, narrated, received } = setup(WATCHING);
    const told = await narrate.execute("1", {
      who: "ann",
      text: "Your chest tightens.",
      aside: true,
    });
    expect(narrated).toEqual([]);
    expect(received[0]?.[1]).toMatchObject({
      sessionKey: "agent:ann:tasks",
      text: "Your chest tightens.",
    });
    expect(told.content[0]?.text).toMatch(/Told only ann/);
  });

  it("sees its cast by place, and anyone in depth with cast", async () => {
    const { service, cast } = setup(WATCHING);
    const view = await service.view("boss");
    expect(view).toContain("### Cast");
    expect(view).toContain("- The park (park): ANN (ann): walking, A walk");
    expect(view).toContain("back: 1.");
    const all = await cast.execute("1", {});
    expect(all.content[0]?.text).toContain("ANN (ann)");
    const ann = (await cast.execute("2", { who: ["ann"] })).content[0]?.text;
    expect(ann).toContain("## ANN (ann)");
    expect(ann).toContain(
      "2026-01-01: [SOFT_GOAL] Meet Ben at the park at 18:00",
    );
    expect(ann).toContain("With: BEN (ben)");
    expect(ann).toContain("> Ben: hi");
    const there = (await cast.execute("3", { place: "park" })).content[0]?.text;
    expect(there).toContain("## BEN (ben) (offstage)");
  });
});
