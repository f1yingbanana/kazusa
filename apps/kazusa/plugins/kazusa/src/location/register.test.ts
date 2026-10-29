import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  DecisionBatch,
  DecisionOutcome,
} from "openclaw/plugin-sdk/decisions";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { Clock } from "../clock/clock.ts";
import { registerDesires } from "../desires/register.ts";
import { registerTaskman } from "../taskman/register.ts";
import { executeDelayTask, executeStartTask } from "../taskman/taskman.ts";
import type { ActiveTask, ToolExecutionContext } from "../taskman/types.ts";
import type { Stimulus } from "../stimulus.ts";
import type { LocationRecord } from "./location.ts";
import { registerLocation } from "./register.ts";

const T0 = Date.parse("2026-10-27T16:00:00.000Z");
const minutes = (n: number): number => T0 + n * 60_000;

function createInMemoryStore<T>() {
  const values = new Map<string, T>();
  return {
    values,
    async lookup(key: string): Promise<T | undefined> {
      return values.get(key);
    },
    async register(key: string, value: T): Promise<void> {
      values.set(key, value);
    },
    async entries() {
      return [...values.entries()].map(([key, value]) => ({
        key,
        value,
        createdAt: 0,
      }));
    },
  };
}

const PAGES: Record<string, string> = {
  "places/school.md": `---
place_id: school
name: School
summary: "Marble paths."
connections:
  - to: dorm
    ways:
      - { by: walk, minutes: 10 }
      - { by: bike, minutes: 4 }
---
`,
  "places/club.md": `---
place_id: club
name: Club Room
parent: school
entry_minutes: 3
summary: "Smells of vanilla."
---

# Club Room

A long table, an oven, a fridge of milk cartons.
`,
  "places/library.md": `---
place_id: library
name: Library
parent: school
summary: "Hushed."
---
`,
  "places/dorm.md": `---
place_id: dorm
name: Dorm
summary: "A quiet lounge."
---
`,
  "places/room_kazusa.md": `---
place_id: room_kazusa
name: Kazusa's Room
parent: dorm
summary: "Tidy and dim."
---

# Kazusa's Room

Hers alone; she locks it whenever she leaves.
`,
  "characters/kazusa.md": `---
character_id: kazusa
home: room_kazusa
---
`,
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});
const temporary = (prefix: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

function setup() {
  const wikiDir = temporary("kazusa-wiki-");
  for (const [file, text] of Object.entries(PAGES)) {
    const target = path.join(wikiDir, "entities", file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  const workspaces = temporary("kazusa-workspaces-");
  const stores = new Map<string, ReturnType<typeof createInMemoryStore>>();
  const methods: Record<
    string,
    (options: {
      params: unknown;
      respond: (ok: boolean, payload: unknown, error: unknown) => void;
    }) => Promise<void>
  > = {};
  const tools: Array<{
    name: string;
    parameters: { required: string[]; properties: Record<string, unknown> };
  }> = [];
  // Every judgment gets the same word.
  const evaluate = vi.fn(
    async (batch: DecisionBatch): Promise<DecisionOutcome> => ({
      status: "ok",
      result: {
        model: "jev",
        answers: Object.fromEntries(
          Object.keys(batch.questions).map((question) => [
            question,
            { type: "choice" as const, choice: "certain", probabilities: {} },
          ]),
        ),
      },
      provenance: {
        providerId: "jev",
        rubricVersion: "1",
        runtimeGeneration: "1",
      },
    }),
  );
  let now = T0;
  const api = {
    config: {
      agents: {
        entries: { kazusa: {}, "kurimura-airi": {}, "yutori-natsu": {} },
      },
    },
    pluginConfig: { location: { wikiDir } },
    logger: { warn: vi.fn(), info: vi.fn() },
    lifecycle: {},
    on() {},
    runtime: {
      agent: {
        resolveAgentWorkspaceDir: (_config: unknown, id: string) =>
          path.join(workspaces, id),
        resolveAgentIdentity: () => undefined,
      },
      decisions: { evaluate },
      state: {
        openKeyedStore: ({ namespace }: { namespace: string }) => {
          if (!stores.has(namespace)) {
            stores.set(namespace, createInMemoryStore());
          }
          return stores.get(namespace);
        },
      },
    },
    registerGatewayMethod: vi.fn((name: string, handler) => {
      methods[name] = handler;
    }),
    registerTool(factory: (ctx: unknown) => (typeof tools)[number]) {
      tools.push(factory({}));
    },
  } as unknown as OpenClawPluginApi;
  const clock = {
    init: vi.fn(async () => {}),
    time: () => now,
    onClockChange: () => () => {},
  } as unknown as Clock;
  // Taskman's store, shared: Location reads the current activity from it.
  const tasks = createInMemoryStore<ActiveTask>();
  stores.set("tasks", tasks);
  const desires = registerDesires(api, { clock });
  const sightings: { agentId: string; text: string; metadata: unknown }[] = [];
  const location = registerLocation(api, {
    clock,
    appendLedger: async ({ agentId, text, metadata }) => {
      sightings.push({ agentId, text, metadata });
    },
  });
  const extensions = [desires.taskExtension, location.taskExtension!];
  const ledger: { text: string; metadata: unknown }[] = [];
  const context = (agentId = "kazusa"): ToolExecutionContext => ({
    agentId,
    store: tasks,
    clock: { time: () => now },
    minDuration: 10,
    prepare: async (transition) =>
      Promise.all(extensions.map((extension) => extension.prepare(transition))),
    appendTaskLedgerEntry: async (text, _timestamp, metadata) => {
      ledger.push({ text, metadata });
    },
  });
  const call = async (name: string, params: unknown) => {
    let result: { ok: boolean; payload: unknown } | undefined;
    await methods[name]?.({
      params,
      respond: (ok, payload) => {
        result = { ok, payload };
      },
    });
    return result;
  };
  const card = (agentId: string, placeId: string): string =>
    path.join(workspaces, agentId, "wiki/entities/places", `${placeId}.md`);
  return {
    api,
    clock,
    stores,
    tasks,
    tools,
    location,
    extensions,
    evaluate,
    ledger,
    sightings,
    context,
    call,
    card,
    setNow: (at: number) => {
      now = at;
    },
  };
}

describe("location registration", () => {
  it("adds a short, required `where` to start_task only", () => {
    const { api, clock, tools, extensions, location } = setup();
    const where = location.taskExtension!.startTaskParameters.where as {
      enum?: string[];
      description: string;
    };
    expect(where.enum).toBeUndefined();
    expect(where.description.length).toBeLessThan(400);
    registerTaskman(api, { clock, extensions });
    const required = (name: string) =>
      tools.find((tool) => tool.name === name)?.parameters.required;
    expect(required("start_task")).toEqual([
      "type",
      "description",
      "duration",
      "afterwards",
      "where",
    ]);
    expect(required("delay_task")).toEqual(["afterwards"]);
  });

  it("starts everyone at home, records the trip and settles the arrival", async () => {
    const { context, ledger, location, stores, setNow, card } = setup();
    expect(await location.record("kazusa")).toEqual({
      placeId: "room_kazusa",
      since: 0,
    });
    const result = await executeStartTask(
      {
        type: "traveling",
        description: "Walking to the club",
        duration: 14,
        afterwards: {},
        where: "Club Room",
      },
      context(),
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain(
      'Started traveling task: "Walking to the club". Traveling from Kazusa\'s Room to Club Room (usually 14 min on foot, 8 by bike); arriving Tue 2026-10-27 16:14. Scheduled to conclude',
    );
    expect(ledger.at(-1)?.metadata).toMatchObject({
      kind: "task.started",
      payload: { where: "club", from: "room_kazusa", usualMinutes: 14 },
    });
    expect(
      (stores.get("location")?.values.get("kazusa") as LocationRecord).trip,
    ).toMatchObject({ to: "club", arriveAt: minutes(14) });
    // Moving on from her room means she took it in: it now has a card.
    expect(existsSync(card("kazusa", "room_kazusa"))).toBe(true);

    setNow(minutes(13));
    await location.settle("kazusa");
    expect(await location.record("kazusa")).toHaveProperty("trip");
    setNow(minutes(14));
    await location.settle("kazusa");
    expect(await location.record("kazusa")).toEqual({
      placeId: "club",
      since: minutes(14),
    });
    // On arrival the club is new to her: the whole description, no card yet.
    expect(existsSync(card("kazusa", "club"))).toBe(false);
    expect(await location.whereabouts("kazusa", minutes(14), "")).toContain(
      "New to you; you take it all in:",
    );
  });

  it("walks a character over instead of refusing an activity elsewhere", async () => {
    const { context, stores } = setup();
    const result = await executeStartTask(
      {
        type: "eating",
        description: "Cake at the club",
        duration: 30,
        afterwards: { satiety: "low→full" },
        where: "club",
      },
      context(),
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain(
      "You walk over from Kazusa's Room first (usually 14 min on foot, 8 by bike), arriving Tue 2026-10-27 16:14. You'll check in when you get there. Scheduled to conclude at 2026-10-27T16:14:00.000Z (14 minutes).",
    );
    // The lease checks in on arrival; what she came for travels with the trip.
    expect(
      (stores.get("location")?.values.get("kazusa") as LocationRecord).trip
        ?.purpose,
    ).toEqual({ description: "Cake at the club", minutes: 16 });
  });

  it("writes nothing anywhere when another extension refuses", async () => {
    const { context, stores, tasks } = setup();
    const result = await executeStartTask(
      {
        type: "traveling",
        description: "Walking to the club",
        duration: 14,
        afterwards: { satiety: "nonsense" },
        where: "club",
      },
      context(),
    );
    expect(result.success).toBe(false);
    expect(stores.get("location")?.values.size).toBe(0);
    expect(tasks.values.size).toBe(0);
  });

  it("moves a trip's arrival when the trip is delayed", async () => {
    const { context, location, setNow } = setup();
    const ctx = context();
    await executeStartTask(
      {
        type: "traveling",
        description: "Biking to the club",
        duration: 10,
        afterwards: {},
        where: "club",
      },
      ctx,
    );
    setNow(minutes(5));
    const delayed = await executeDelayTask(
      { additionalDuration: 10, reason: "Flat tyre", afterwards: {} },
      ctx,
    );
    expect(delayed.message).toContain(
      "Now arriving at Club Room Tue 2026-10-27 16:20.",
    );
    expect(delayed.payload).toMatchObject({ arriveAt: minutes(20) });
    expect((await location.record("kazusa"))?.trip?.arriveAt).toBe(minutes(20));
  });

  it("walks a visitor in without asking the decision model", async () => {
    // Whether the door opens is the visitor's to play out; one call saved.
    const h = setup();
    await h.call("location.place", { id: "kurimura-airi", placeId: "dorm" });
    await executeStartTask(
      {
        type: "socializing",
        description: "Dropping by Kazusa's room",
        duration: 20,
        afterwards: {},
        where: "room_kazusa",
      },
      h.context("kurimura-airi"),
    );
    h.setNow(minutes(1));
    expect(await h.location.settle("kurimura-airi")).toBe(
      "You've arrived at Kazusa's Room `room_kazusa` (Dorm). You came here for \"Dropping by Kazusa's room\", planning about 19 min. Carry on with it, or change your mind.",
    );
    expect(await h.location.record("kurimura-airi")).toEqual({
      placeId: "room_kazusa",
      since: minutes(1),
    });
    // Only noticing is judged: Airi and Kazusa see each other.
    for (const [batch] of h.evaluate.mock.calls)
      expect(Object.keys(batch.questions)).toEqual(["notice"]);
  });

  it("brings known and mentioned places to mind, without the whole map", async () => {
    const { location, card } = setup();
    const write = (file: string, text: string): void => {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text);
    };
    write(card("kazusa", "room_kazusa"), "---\nplace_id: room_kazusa\n---\n");
    expect(
      await location.whereabouts("kazusa", T0, "Meet me at the library later?"),
    ).toBe(
      [
        "Kazusa's Room `room_kazusa` (Dorm). Tidy and dim.",
        "With you: no one you've noticed.",
        "Around you: Dorm `dorm` 1 min",
        "Places you know: Library `library` 12 min on foot, 6 by bike",
      ].join("\n"),
    );
    // Cards she has, and places in her plans, come to mind unprompted.
    write(card("kazusa", "club"), "---\nplace_id: club\n---\n");
    write(
      path.join(
        path.dirname(
          path.dirname(path.dirname(path.dirname(card("kazusa", "club")))),
        ),
        "MEMORY.md",
      ),
      "## Plans\n- [HARD_BLOCK] 17:00 study at the Library with Airi\n",
    );
    const unprompted = await location.whereabouts("kazusa", T0, "");
    expect(unprompted).toContain("Club Room `club`");
    expect(unprompted).toContain("Library `library`");
    expect(unprompted).not.toContain("School `school` 11");
  });

  it("places participants through the operator RPC", async () => {
    const { call, location } = setup();
    expect(
      await call("location.place", { id: "user:sensei", placeId: "school" }),
    ).toMatchObject({
      ok: true,
      payload: { position: { kind: "at", placeId: "school", since: T0 } },
    });
    expect(await location.record("user:sensei")).toMatchObject({
      placeId: "school",
    });
    expect(
      await call("location.place", { id: "nobody", placeId: "school" }),
    ).toMatchObject({ ok: false });
    expect(
      await call("location.place", { id: "kazusa", placeId: "nowhere" }),
    ).toMatchObject({ ok: false });
  });

  it("sights arrivals both ways, a huddle as one group, and a leaver by those who noticed", async () => {
    const { context, location, call, setNow, sightings } = setup();
    const received: Stimulus[] = [];
    location.attachPerception({
      receive: async (_agentId, stimulus) => {
        received.push(stimulus);
      },
    });
    const left: { who: string; placeId: string; toward?: string }[] = [];
    location.attachConversations({
      huddlesAt: async (placeId) =>
        placeId === "club"
          ? [
              {
                address: "chat:huddle:h1",
                members: ["kurimura-airi", "yutori-natsu"],
              },
            ]
          : [],
      leavePlace: async (who, _name, placeId, { toward }) => {
        left.push({ who, placeId, ...(toward ? { toward } : {}) });
      },
    });
    await call("location.place", { id: "kurimura-airi", placeId: "club" });
    await call("location.place", { id: "yutori-natsu", placeId: "club" });
    received.length = 0;

    const ctx = context();
    await executeStartTask(
      {
        type: "traveling",
        description: "Walking to the club",
        duration: 14,
        afterwards: {},
        where: "club",
      },
      ctx,
    );
    expect(left).toEqual([
      { who: "kazusa", placeId: "room_kazusa", toward: "Dorm" },
    ]);
    setNow(minutes(14));
    await location.settle("kazusa");
    const ids = received.map(({ id }) => id);
    // One sighting of the huddle for her, and each of them may notice her.
    expect(ids).toEqual([
      `sighting|arrive|kurimura-airi|club|${minutes(14)}`,
      `sighting|comes|kazusa|club|${minutes(14)}`,
      `sighting|comes|kazusa|club|${minutes(14)}`,
    ]);
    const [arrive, comesAiri] = received;

    const seen = await location.confirm("kazusa", arrive);
    expect(seen?.text).toBe(
      "You see `kurimura-airi` and `yutori-natsu`, talking (chat:huddle:h1) here.",
    );
    expect(sightings.at(-1)?.metadata).toMatchObject({
      kind: "location.noticed",
      payload: {
        subjects: ["kurimura-airi", "yutori-natsu"],
        moment: "arrive",
        huddle: "chat:huddle:h1",
      },
    });
    // The rest of the group is the same sighting.
    expect(
      await location.confirm("kazusa", {
        ...arrive,
        id: `sighting|arrive|yutori-natsu|club|${minutes(14)}`,
      }),
    ).toBeUndefined();
    expect(await location.whereabouts("kazusa", minutes(14), "")).toContain(
      "With you: `kurimura-airi` (talking, chat:huddle:h1) · `yutori-natsu` (talking, chat:huddle:h1)",
    );
    expect(await location.inCompany("kazusa", minutes(14))).toBe(true);

    expect((await location.confirm("kurimura-airi", comesAiri))?.text).toBe(
      "`kazusa` comes in.",
    );

    // Kazusa heads off: Airi, who noticed her, sees her go.
    received.length = 0;
    await executeStartTask(
      {
        type: "traveling",
        description: "Back home",
        duration: 14,
        afterwards: {},
        where: "room_kazusa",
      },
      ctx,
    );
    expect(left.at(-1)).toEqual({
      who: "kazusa",
      placeId: "club",
      toward: "School",
    });
    expect(received).toContainEqual(
      expect.objectContaining({
        id: `departure|kazusa|club|${minutes(14)}`,
        text: "`kazusa` leaves, heading toward School.",
      }),
    );
  });

  it("foresees crossings, then confirms and records a sighting when it happens", async () => {
    const { context, location, call, setNow, sightings } = setup();
    const received: Stimulus[] = [];
    location.attachPerception({
      receive: async (_agentId, stimulus) => {
        received.push(stimulus);
      },
    });
    // Airi stands on the school grounds; Kazusa's trip to the club passes them.
    await call("location.place", { id: "kurimura-airi", placeId: "school" });
    received.length = 0;
    await executeStartTask(
      {
        type: "traveling",
        description: "Walking to the club",
        duration: 14,
        afterwards: {},
        where: "club",
      },
      context(),
    );
    const crossing = received.find(
      ({ id }) => id === `sighting|cross|kazusa|school|${minutes(11)}`,
    );
    expect(crossing).toMatchObject({
      sessionKey: "agent:kurimura-airi:tasks",
      timestamp: minutes(11),
      foreseen: true,
    });
    expect(received.map(({ id }) => id)).toContain(
      `sighting|cross|kurimura-airi|school|${minutes(11)}`,
    );

    setNow(minutes(11));
    expect((await location.confirm("kurimura-airi", crossing!))?.text).toBe(
      "`kazusa` passes through School, heading toward Club Room.",
    );
    // A passer-by is seen, not counted as here.
    expect((await location.record("kurimura-airi"))?.noticed ?? []).toEqual([]);
    expect(sightings.at(-1)).toMatchObject({
      agentId: "kurimura-airi",
      metadata: {
        kind: "location.noticed",
        payload: { subjects: ["kazusa"], placeId: "school", word: "certain" },
      },
    });
    // A plan that changed by then does not happen.
    await call("location.place", { id: "kurimura-airi", placeId: "dorm" });
    expect(await location.confirm("kurimura-airi", crossing!)).toBeUndefined();
  });

  it("foresees two people meeting head-on along one stretch, and confirms it", async () => {
    const { context, location, call, setNow, sightings } = setup();
    const received: Stimulus[] = [];
    location.attachPerception({
      receive: async (_agentId, stimulus) => {
        received.push(stimulus);
      },
    });
    // Airi walks School → Dorm (0–10) while Kazusa walks Dorm → School (1–11):
    // neither passes anywhere the other stands, but they meet on the path.
    await call("location.place", { id: "kurimura-airi", placeId: "school" });
    await executeStartTask(
      {
        type: "traveling",
        description: "Going home",
        duration: 10,
        afterwards: {},
        where: "dorm",
      },
      context("kurimura-airi"),
    );
    received.length = 0;
    await executeStartTask(
      {
        type: "traveling",
        description: "Walking to the club",
        duration: 14,
        afterwards: {},
        where: "club",
      },
      context(),
    );
    const at = minutes(5.5);
    const meeting = received.find(
      ({ id }) => id === `sighting|meet|kurimura-airi|dorm|${at}|school`,
    );
    expect(meeting).toMatchObject({
      sessionKey: "agent:kazusa:tasks",
      timestamp: at,
      foreseen: true,
    });
    expect(received.map(({ id }) => id)).toEqual([
      `sighting|meet|kurimura-airi|dorm|${at}|school`,
      `sighting|meet|kazusa|dorm|${at}|school`,
    ]);

    setNow(at);
    expect((await location.confirm("kazusa", meeting!))?.text).toBe(
      "On the way between Dorm and School, you pass `kurimura-airi` going the other way.",
    );
    expect(sightings.at(-1)).toMatchObject({
      agentId: "kazusa",
      metadata: {
        kind: "location.noticed",
        payload: { moment: "meet", placeId: "dorm", between: "school" },
      },
    });
    // Airi turned back before they met.
    await call("location.place", { id: "kurimura-airi", placeId: "school" });
    expect(await location.confirm("kazusa", meeting!)).toBeUndefined();
  });
});
