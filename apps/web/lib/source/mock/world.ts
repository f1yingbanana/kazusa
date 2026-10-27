import type {
  CharacterDetail,
  CharacterStatus,
  CharacterSummary,
  ChatType,
  JournalEvent,
  StreamEvent,
  TaskSummary,
} from "@kazusa/client";
import { HOUR, MINUTE } from "../../time/sim";

/*
 * Deterministic placeholder world. Everything here is concept data for
 * domains the plugin doesn't serve yet; panels that use it show a Mock tag.
 * Names are generic on purpose (D1): the client must work for any setting.
 */

export const MOCK_WORLD_START = Date.UTC(2026, 3, 14, 14, 32);
export const MOCK_PLAYER = { id: "user:you", name: "You" } as const;
const HISTORY = 36 * HOUR;

export type Rng = () => number;

/** mulberry32: small, fast, seedable. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (rng: Rng, min: number, max: number) =>
  min + Math.floor(rng() * (max - min + 1));
const pick = <T>(rng: Rng, items: readonly T[]) =>
  items[Math.floor(rng() * items.length)];
const chance = (rng: Rng, p: number) => rng() < p;
const slug = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const AFFILIATIONS = [
  { name: "Archive Society", occupations: ["Archivist", "Cataloguer", "Restorer"] },
  { name: "Harbor Watch", occupations: ["Watch officer", "Lookout", "Dock clerk"] },
  { name: "Botanical Circle", occupations: ["Gardener", "Herbalist", "Seed keeper"] },
  { name: "Clocktower Workshop", occupations: ["Machinist", "Apprentice", "Tinkerer"] },
  { name: "River Clinic", occupations: ["Nurse", "Physician", "Orderly"] },
  { name: "Lantern Theatre", occupations: ["Actor", "Stagehand", "Playwright"] },
  { name: "Observatory", occupations: ["Astronomer", "Instrument maker", "Calculator"] },
  { name: "Night Market", occupations: ["Vendor", "Cook", "Bookkeeper"] },
  { name: "Courier Office", occupations: ["Courier", "Sorter", "Dispatcher"] },
  { name: "Academy", occupations: ["Student", "Lecturer", "Tutor"] },
] as const;

const FIRST = [
  "Ada", "Bram", "Cleo", "Dario", "Edda", "Felix", "Greta", "Hugo", "Ines",
  "Jonah", "Kira", "Leon", "Mira", "Nils", "Oona", "Pavel", "Quinn", "Rosa",
  "Silas", "Tova", "Uma", "Viktor", "Wren", "Xavi", "Yara", "Zeno", "Aiko",
  "Bea", "Cyrus", "Dahlia", "Emil", "Farah", "Gideon", "Hana", "Ivo", "Juno",
  "Kofi", "Lena", "Mateo", "Noor", "Otto", "Priya", "Rafe", "Sana", "Theo",
  "Ulla", "Vera", "Wim", "Yusuf", "Zora",
];
const LAST = [
  "Abara", "Brandt", "Castell", "Dorn", "Eklund", "Faro", "Grieve", "Holm",
  "Ishida", "Jansen", "Kovac", "Lind", "Marlow", "Novak", "Okafor", "Pell",
  "Quist", "Rook", "Sato", "Thorne", "Ueda", "Vance", "Weller", "Yoon",
  "Zeller", "Amari", "Bishop", "Crane", "Delacroix", "Ferris",
];
const TRAITS = [
  "curious", "patient", "stubborn", "warm", "guarded", "meticulous", "restless",
  "playful", "earnest", "dry-humored", "ambitious", "gentle", "blunt", "dreamy",
];

type TaskTemplate = {
  type: string;
  descriptions: readonly string[];
  minutes: readonly [number, number];
};

const DAY_TASKS: readonly TaskTemplate[] = [
  { type: "read", descriptions: ["Reading a field journal", "Reading old letters", "Skimming the morning paper"], minutes: [20, 90] },
  { type: "work", descriptions: ["Sorting the day's intake", "Repairing a worn mechanism", "Drafting a report"], minutes: [45, 180] },
  { type: "eat", descriptions: ["Having lunch", "Grabbing a quick snack", "Sharing tea"], minutes: [15, 45] },
  { type: "walk", descriptions: ["Walking along the river", "Running an errand", "Taking the long way back"], minutes: [15, 60] },
  { type: "study", descriptions: ["Studying for an exam", "Practicing notation", "Reviewing notes"], minutes: [30, 120] },
  { type: "talk", descriptions: ["Catching up with a friend", "Arguing about a plan", "Listening to a story"], minutes: [15, 60] },
  { type: "rest", descriptions: ["Resting on a bench", "Staring out the window", "Taking a short break"], minutes: [10, 40] },
  { type: "cook", descriptions: ["Cooking dinner", "Baking bread", "Prepping ingredients"], minutes: [30, 90] },
  { type: "write", descriptions: ["Writing in a diary", "Composing a letter", "Editing a draft"], minutes: [20, 90] },
];
const NIGHT_TASK: TaskTemplate = {
  type: "sleep",
  descriptions: ["Sleeping", "Sleeping in late", "Napping"],
  minutes: [300, 480],
};

const MONOLOGUES = [
  "Just one more page, then I'll go.",
  "I keep thinking about what they said yesterday.",
  "If I finish this now, tomorrow is free.",
  "Nobody will notice if I take the long way.",
  "I should have asked for help with this.",
  "Maybe they're still waiting for my answer.",
  "This is harder than it looked this morning.",
  "I could get used to quiet afternoons like this.",
];
const DELAY_REASONS = [
  "Ran into someone on the way.",
  "It took longer than expected.",
  "Got distracted halfway through.",
  "Wanted to do it properly.",
];
const MESSAGE_LINES = [
  "anyone free later?",
  "did you see the notice by the gate?",
  "running a bit late, save me a seat",
  "that went better than I expected",
  "can someone cover for me tomorrow?",
  "I found the thing you were looking for",
  "meeting moved to the evening",
  "thanks for earlier",
  "who left the lights on again",
  "back in ten",
];

export interface MockChat {
  readonly id: string;
  readonly type: ChatType;
  readonly title: string;
  readonly members: string[];
}

let worldCounter = 0;

export interface MockWorld {
  /** Instance id, used in cache keys so a regenerated world never serves stale pages. */
  readonly id: number;
  readonly title: string;
  readonly characters: CharacterSummary[];
  readonly details: Map<string, CharacterDetail>;
  readonly chats: MockChat[];
  /** Ascending by seq. Mutated by `advanceMockWorld` (it's the mock "server"). */
  readonly journal: JournalEvent[];
  readonly statuses: Map<string, CharacterStatus>;
  readonly rng: Rng;
  nextSeq: number;
  taskCounter: number;
}

function taskTemplate(rng: Rng, at: number) {
  const hour = new Date(at).getUTCHours();
  const night = hour >= 23 || hour < 6;
  return night && chance(rng, 0.85) ? NIGHT_TASK : pick(rng, DAY_TASKS);
}

type Draft = Omit<JournalEvent, "seq">;

function startTask(
  world: Pick<MockWorld, "rng" | "taskCounter"> & { taskCounter: number },
  characterId: string,
  at: number,
  replacedTaskId?: string,
): { event: Draft; task: TaskSummary } {
  const { rng } = world;
  const template = taskTemplate(rng, at);
  const duration = int(rng, template.minutes[0], template.minutes[1]);
  const id = `task-${++world.taskCounter}`;
  const task: TaskSummary = {
    id,
    type: template.type,
    description: pick(rng, template.descriptions),
    startedAt: at,
    endAt: at + duration * MINUTE,
  };
  return {
    task,
    event: {
      kind: "task.started",
      simTime: at,
      actors: [characterId],
      payload: {
        taskId: id,
        type: task.type,
        description: task.description,
        duration,
        endAt: task.endAt,
        monologue: chance(rng, 0.35) ? pick(rng, MONOLOGUES) : undefined,
        replacedTaskId,
      },
    } as Draft,
  };
}

function generateCharacters(rng: Rng, count: number) {
  const characters: CharacterSummary[] = [];
  const details = new Map<string, CharacterDetail>();
  const used = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    let name = "";
    do name = `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
    while (used.has(name));
    used.add(name);
    const affiliation = AFFILIATIONS[index % AFFILIATIONS.length];
    const occupation = pick(rng, affiliation.occupations);
    const npc = index % 15 === 14;
    const summary: CharacterSummary = {
      id: slug(name),
      name,
      kind: npc ? "npc" : "agent",
      occupation,
      affiliation: affiliation.name,
      aliases: chance(rng, 0.3) ? [name.split(" ")[0].slice(0, 3)] : [],
    };
    const traits = [...new Set([pick(rng, TRAITS), pick(rng, TRAITS), pick(rng, TRAITS)])];
    characters.push(summary);
    details.set(summary.id, {
      ...summary,
      role: occupation,
      personalityTraits: traits,
      bodyMarkdown: `## Background\n\n${name} works as ${occupation.toLowerCase()} with the ${affiliation.name}. Placeholder profile text from the mock world; the real card body comes from the World Wiki.`,
    });
  }
  return { characters, details };
}

function generateChats(rng: Rng, agents: CharacterSummary[]): MockChat[] {
  const chats: MockChat[] = [];
  const byAffiliation = new Map<string, string[]>();
  for (const agent of agents) {
    const key = agent.affiliation ?? "Unaffiliated";
    byAffiliation.set(key, [...(byAffiliation.get(key) ?? []), agent.id]);
  }
  for (const [affiliation, members] of byAffiliation) {
    chats.push({
      id: `group:${slug(affiliation)}`,
      type: "group",
      title: affiliation,
      members: members.slice(0, 12),
    });
  }
  for (let index = 0; index < Math.min(20, agents.length / 2); index += 1) {
    const a = pick(rng, agents);
    const b = pick(rng, agents);
    if (a.id === b.id) continue;
    const id = `direct:${[a.id, b.id].sort().join("+")}`;
    if (chats.some((chat) => chat.id === id)) continue;
    chats.push({ id, type: "direct", title: `${a.name} · ${b.name}`, members: [a.id, b.id] });
  }
  return chats;
}

function initialStatus(
  rng: Rng,
  task: TaskSummary | undefined,
  chats: MockChat[],
  characterId: string,
): CharacterStatus {
  const memberOf = chats.filter((chat) => chat.members.includes(characterId));
  const composing = memberOf.length > 0 && chance(rng, 0.03);
  return {
    task,
    brain: chance(rng, 0.08) ? "thinking" : "idle",
    composingIn: composing ? [pick(rng, memberOf).id] : [],
    queued: chance(rng, 0.1) ? int(rng, 1, 3) : 0,
  };
}

/**
 * Builds the world. When `characters` is given (the characters domain is
 * live), only statuses, chats and journal history are invented around them.
 */
export function createMockWorld(options: {
  seed?: number;
  count?: number;
  characters?: CharacterSummary[];
  now?: number;
} = {}): MockWorld {
  const rng = createRng(options.seed ?? 7);
  const now = options.now ?? MOCK_WORLD_START;
  const generated = options.characters
    ? { characters: options.characters, details: new Map<string, CharacterDetail>() }
    : generateCharacters(rng, options.count ?? 150);
  const characters = options.characters
    ? generated.characters
    : [...generated.characters, { ...MOCK_PLAYER, kind: "player" as const, aliases: [] }];
  const agents = characters.filter((c) => c.kind === "agent");
  const chats = generateChats(rng, agents);

  const counter = { rng, taskCounter: 0 };
  const drafts: Draft[] = [];
  const current = new Map<string, TaskSummary>();

  for (const agent of agents) {
    let at = now - HISTORY + int(rng, 0, 120) * MINUTE;
    while (at < now) {
      const { event, task } = startTask(counter, agent.id, at);
      drafts.push(event);
      let end = task.endAt;
      if (task.type !== "sleep" && chance(rng, 0.12)) {
        const extra = int(rng, 10, 40);
        const delayAt = task.startedAt + Math.floor((task.endAt - task.startedAt) * 0.7);
        end += extra * MINUTE;
        drafts.push({
          kind: "task.delayed",
          simTime: delayAt,
          actors: [agent.id],
          payload: {
            taskId: task.id,
            additionalMinutes: extra,
            endAt: end,
            reason: pick(rng, DELAY_REASONS),
            monologue: chance(rng, 0.3) ? pick(rng, MONOLOGUES) : undefined,
          },
        } as Draft);
      }
      current.set(agent.id, { ...task, endAt: end });
      at = end;
    }
  }

  for (const chat of chats) {
    const count = chat.type === "group" ? int(rng, 15, 60) : int(rng, 3, 15);
    for (let index = 0; index < count; index += 1) {
      const senderId = pick(rng, chat.members);
      const simTime = now - Math.floor(rng() * HISTORY);
      drafts.push({
        kind: "message.sent",
        simTime,
        actors: chat.members,
        chatId: chat.id,
        payload: {
          messageId: `${chat.id}#${index}`,
          sequence: index + 1,
          senderId,
          preview: pick(rng, MESSAGE_LINES),
        },
      } as Draft);
    }
  }

  for (const chat of chats.filter((c) => c.type === "group").slice(0, 3)) {
    drafts.push({
      kind: "chat.created",
      simTime: now - HISTORY + int(rng, 0, 600) * MINUTE,
      actors: chat.members,
      chatId: chat.id,
      payload: { type: "group", title: chat.title, members: chat.members },
    } as Draft);
  }
  drafts.push({
    kind: "clock.changed",
    simTime: now - 6 * HOUR,
    actors: [],
    payload: { speed: 10 },
  } as Draft);

  drafts.sort((a, b) => a.simTime - b.simTime);
  const journal = drafts.map((draft, index) => ({ ...draft, seq: index + 1 }) as JournalEvent);

  const statuses = new Map<string, CharacterStatus>();
  for (const agent of agents) {
    statuses.set(agent.id, initialStatus(rng, current.get(agent.id), chats, agent.id));
  }

  return {
    id: ++worldCounter,
    title: "Mock World",
    characters: characters.map((c) =>
      c.kind === "agent" ? { ...c, status: statuses.get(c.id) } : c,
    ),
    details: generated.details,
    chats,
    journal,
    statuses,
    rng,
    nextSeq: journal.length + 1,
    taskCounter: counter.taskCounter,
  };
}

/**
 * One tick of the mock "server". Starts follow-up tasks for characters whose
 * task has ended, flips a few brain states, and sometimes posts a message.
 * Returns the SSE-shaped events a real observer stream would send.
 */
export function advanceMockWorld(world: MockWorld, now: number, maxStarts = 12) {
  const { rng } = world;
  const events: StreamEvent[] = [];
  const changed = new Set<string>();
  const append = (draft: Draft) => {
    const event = { ...draft, seq: world.nextSeq++ } as JournalEvent;
    world.journal.push(event);
    events.push({ type: "journal", event });
  };

  let starts = 0;
  for (const [id, status] of world.statuses) {
    if (starts >= maxStarts) break;
    if (!status.task || status.task.endAt > now) continue;
    // Journal simTime is the clock at the mutation, like the real producer.
    const started = startTask(world, id, now, undefined);
    append(started.event);
    world.statuses.set(id, { ...status, task: started.task });
    changed.add(id);
    starts += 1;
  }

  const ids = [...world.statuses.keys()];
  for (let flip = 0; flip < 3 && ids.length > 0; flip += 1) {
    const id = pick(rng, ids);
    const status = world.statuses.get(id);
    if (!status) continue;
    const memberOf = world.chats.filter((chat) => chat.members.includes(id));
    // Waking is rarer than settling, so the share of thinking characters stays near ~8%.
    const wakes = status.brain !== "thinking" && chance(rng, 0.15);
    if (status.brain !== "thinking" && !wakes) continue;
    world.statuses.set(id, {
      ...status,
      brain: wakes ? "thinking" : "idle",
      composingIn:
        wakes && memberOf.length > 0 && chance(rng, 0.25) ? [pick(rng, memberOf).id] : [],
    });
    changed.add(id);
  }

  if (world.chats.length > 0 && chance(rng, 0.35)) {
    const chat = pick(rng, world.chats);
    const senderId = pick(rng, chat.members);
    append({
      kind: "message.sent",
      simTime: now,
      actors: chat.members,
      chatId: chat.id,
      payload: {
        messageId: `${chat.id}#live-${world.nextSeq}`,
        sequence: world.nextSeq,
        senderId,
        preview: pick(rng, MESSAGE_LINES),
      },
    } as Draft);
  }

  for (const id of changed) {
    const status = world.statuses.get(id);
    if (status) events.push({ type: "status", characterId: id, status });
  }
  return events;
}
