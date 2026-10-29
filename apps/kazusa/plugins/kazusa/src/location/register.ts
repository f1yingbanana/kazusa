import { currentConfig } from "../current-config.ts";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { z } from "zod";
import type { Clock } from "../clock/clock.ts";
import { readCharacterFiles } from "../context-engine/decision-sources.ts";
import { formatSimTime } from "../context-engine/format.ts";
import { characterName } from "../identity.ts";
import { personLabel } from "../person-label.ts";
import { createSkillLoader } from "../context-engine/skill-loader.ts";
import { readFrontmatter } from "../markdown/frontmatter.ts";
import { appendLedgerEntry } from "../ledger.ts";
import type { Perception } from "../perception/perception.ts";
import type { Stage } from "../stage/stage.ts";
import { nextJournalSeq, type KazusaRealtimeBroadcaster } from "../realtime.ts";
import type { Stimulus } from "../stimulus.ts";
import type { ActiveTask, TaskExtension } from "../taskman/types.ts";
import type { Huddle } from "../messaging/messaging.ts";
import { crossings } from "./encounters.ts";
import { clientRecord } from "./http.ts";
import { LOCATION_CONFIG, USER, type LocationConfig } from "./config.ts";
import { judge } from "./judgment.ts";
import {
  placesNamedIn,
  readPlaceCards,
  writePlaceStub,
  type PlaceCard,
} from "./knowledge.ts";
import {
  arrive,
  planTransition,
  positionAt,
  renderWhereabouts,
  type Companion,
  type LocationRecord,
  type PlaceKnowledge,
} from "./location.ts";
import {
  buildMap,
  parsePlace,
  placeLabel,
  type Place,
  type WorldMap,
} from "./map.ts";

/** The map plus where each participant lives. */
export interface World {
  readonly map: WorldMap;
  readonly homes: ReadonlyMap<string, string>;
}

const CHARACTER_HOME = z.object({
  character_id: z.string().optional(),
  home: z.string().optional(),
});

const markdownFiles = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => file.endsWith(".md"))
        .sort()
    : [];

/**
 * Reads the World Wiki once. Returns `undefined` for a world without places,
 * and throws for a broken map: that is an operator error, never a character's.
 */
export function loadWorld(wikiDir: string): World | undefined {
  const placesDir = path.join(wikiDir, "entities", "places");
  const files = markdownFiles(placesDir);
  if (files.length === 0) return undefined;
  const map = buildMap(
    files.map((file) => {
      try {
        return parsePlace(readFileSync(path.join(placesDir, file), "utf8"));
      } catch (error: unknown) {
        throw new Error(`Invalid place ${file}: ${String(error)}`, {
          cause: error,
        });
      }
    }),
  );
  const homes = new Map<string, string>();
  const charactersDir = path.join(wikiDir, "entities", "characters");
  for (const file of markdownFiles(charactersDir)) {
    const { data } = readFrontmatter(
      readFileSync(path.join(charactersDir, file), "utf8"),
      CHARACTER_HOME,
    );
    if (data.home === undefined) continue;
    if (!map.places.has(data.home)) {
      throw new Error(`Character ${file}: unknown home ${data.home}`);
    }
    homes.set(data.character_id ?? file.slice(0, -".md".length), data.home);
  }
  return { map, homes };
}

/** The `where` parameter: short and stable, whatever the size of the world. */
function whereParameter(config: LocationConfig) {
  const travel = config.travelCategories.map((type) => `\`${type}\``);
  return {
    type: "string",
    description: `Where this activity happens: a place from Where you are (id or name), or your own words for a spot where you are. Somewhere else, you walk over first. With ${travel.join(" or ")}, the trip is the activity: \`where\` is your destination and its duration is how long you take, however you go.`,
  };
}

/** Caps a file excerpt for decision evidence. */
const excerpt = (text: string | null, chars = 800): string | null =>
  text === null ? null : text.slice(0, chars);

export interface LocationService {
  readonly world?: World;
  /** Absent for a world without places. */
  readonly taskExtension?: TaskExtension;
  /** The stored record, or the participant's home. */
  readonly record: (id: string) => Promise<LocationRecord | undefined>;
  /**
   * The situation message's `Where you are` lines. `evidence` is this turn's
   * input: places it names come to mind.
   */
  readonly whereabouts: (
    agentId: string,
    at: number,
    evidence: string,
  ) => Promise<string | undefined>;
  /**
   * Completes a finished trip when a task deadline fires, and returns what the
   * check-in should tell the character about arriving.
   */
  readonly settle: (agentId: string) => Promise<string | undefined>;
  /** Onstage characters and the player. */
  readonly participants: () => Promise<string[]>;
  /**
   * Going offstage: they leave where they stand, seen by whoever had noticed
   * them, and their conversations there go on without them.
   */
  readonly exit: (id: string, at: number) => Promise<void>;
  /**
   * Coming back onstage: they are where they were (or on their way), seen by
   * whoever is there as if they had just come in.
   */
  readonly enter: (id: string, at: number) => Promise<void>;
  /**
   * Puts someone at a place now, without travel. Operators place characters;
   * the player, who has no tasks, moves only this way.
   */
  readonly place: (id: string, placeId: string) => Promise<LocationRecord>;
  /** Whether the character is talking with or has noticed someone here. */
  readonly inCompany: (agentId: string, at: number) => Promise<boolean>;
  /** Where a participant stands now, or `undefined` while traveling. */
  readonly placeOf: (
    id: string,
  ) => Promise<
    { readonly placeId: string; readonly title: string } | undefined
  >;
  /** Where sightings go; Perception is registered after Location. */
  readonly attachPerception: (target: Pick<Perception, "receive">) => void;
  /** Huddles, from Messaging, which is registered after Location. */
  readonly attachConversations: (target: Conversations) => void;
  /**
   * Perception's `confirm`: does a sighting still happen when its moment comes,
   * and as what? `undefined` drops it unseen.
   */
  readonly confirm: (
    agentId: string,
    item: Stimulus,
  ) => Promise<Stimulus | undefined>;
}

/** The part of Messaging that Location reads and drives. */
export interface Conversations {
  huddlesAt(placeId: string): Promise<readonly Huddle[]>;
  leavePlace(
    who: string,
    name: string,
    placeId: string,
    options: { readonly toward?: string; readonly at: number },
  ): Promise<void>;
}

/**
 * Registers the `"location"` store, the `where` task extension and the
 * `location.*` RPCs. Position changes only through task leases; nothing is
 * refused by rule, and what depends on circumstances is judged.
 */
export function registerLocation(
  api: OpenClawPluginApi,
  deps: {
    readonly clock: Pick<Clock, "time" | "init">;
    /** Writes a row to a character's `:tasks` ledger; defaults to the SDK's. */
    readonly appendLedger?: (entry: {
      readonly agentId: string;
      readonly text: string;
      readonly timestamp: number;
      readonly metadata: unknown;
    }) => Promise<void>;
    /** Observer SSE: `location` on every record write, `journal` on sightings. */
    readonly broadcaster?: KazusaRealtimeBroadcaster;
    /** Offstage characters are nowhere. Absent: everyone is onstage. */
    readonly stage?: Pick<Stage, "isOnstage" | "onstage" | "presentAt">;
  },
): LocationService {
  const getConfig = () => currentConfig(api);
  const { clock, broadcaster } = deps;
  const appendLedger =
    deps.appendLedger ??
    ((entry) => appendLedgerEntry(api, { ...entry, stream: "tasks" }));
  const config = LOCATION_CONFIG.parse(api.pluginConfig?.location ?? {});
  const store = api.runtime.state.openKeyedStore<LocationRecord>({
    namespace: "location",
    retention: "retained",
  });
  /** Every write goes through here, so observers see each one. */
  const save = async (id: string, next: LocationRecord): Promise<void> => {
    await store.register(id, next);
    broadcaster?.broadcast({
      type: "location",
      characterId: id,
      record: clientRecord(next),
    });
  };
  const world = loadWorld(config.wikiDir);
  const warn = (message: string): void => api.logger.warn(message);
  const skillLoader = createSkillLoader({
    config: getConfig(),
    pluginRootDir: api.rootDir,
  });
  /** Configured characters and the player, onstage or not. */
  const everyone = (): string[] => [
    ...new Set([
      ...listAgentIds(getConfig()),
      USER.parse(api.pluginConfig?.user ?? {}).id,
    ]),
  ];
  const participants = async (): Promise<string[]> =>
    deps.stage ? await deps.stage.onstage(everyone()) : everyone();
  const isUser = (id: string): boolean => id.startsWith("user:");
  const workspaceOf = (id: string): string | undefined =>
    isUser(id)
      ? undefined
      : api.runtime.agent.resolveAgentWorkspaceDir(getConfig(), id);
  const record = async (id: string): Promise<LocationRecord | undefined> => {
    const stored = await store.lookup(id);
    if (stored) return stored;
    const home = world?.homes.get(id);
    return home === undefined ? undefined : { placeId: home, since: 0 };
  };
  const cardsOf = async (id: string): Promise<PlaceCard[]> => {
    const workspace = workspaceOf(id);
    return workspace ? await readPlaceCards(workspace, warn) : [];
  };
  /** First time standing somewhere starts a card in the personal wiki. */
  const remember = async (id: string, placeId: string, at: number) => {
    const workspace = workspaceOf(id);
    const place = world?.map.places.get(placeId);
    if (!workspace || !place) return;
    try {
      await writePlaceStub(workspace, place, at);
    } catch (error: unknown) {
      warn(`Location: could not start a card for ${placeId}: ${String(error)}`);
    }
  };

  if (!world) {
    warn(
      `Location: no places under ${config.wikiDir}; characters have no positions.`,
    );
  }
  const tasks = api.runtime.state.openKeyedStore<ActiveTask>({
    namespace: "tasks",
    retention: "retained",
  });
  const userConfig = USER.parse(api.pluginConfig?.user ?? {});
  /** The name others know them by, never their id. */
  const displayName = async (id: string): Promise<string> =>
    isUser(id)
      ? id === userConfig.id
        ? userConfig.name
        : id
      : await characterName(api, getConfig(), id).catch(() => id);

  /** Who someone is and where they are, as evidence for a judgment. */
  const person = async (map: WorldMap, id: string, at: number) => {
    const workspace = workspaceOf(id);
    const files = workspace ? await readCharacterFiles(workspace) : null;
    const position = await record(id).then((current) =>
      current ? positionAt(current, at) : undefined,
    );
    const task = await tasks.lookup(id);
    const home = world?.homes.get(id);
    return {
      id,
      name: await displayName(id),
      // Whose place is whose: live, Airi going into her own room was judged
      // only likely without it.
      ...(home === undefined ? {} : { home: placeLabel(map, home) }),
      identity: excerpt(files?.identity ?? null),
      soul: excerpt(files?.soul ?? null, 600),
      ...(task
        ? { activity: { type: task.type, description: task.description } }
        : {}),
      whereNow:
        position?.kind === "at"
          ? placeLabel(map, position.placeId)
          : position
            ? `on the way to ${placeLabel(map, position.trip.to)}`
            : "unknown",
    };
  };
  const judgeWith = (agentId: string, question: string) => ({
    evaluate: api.runtime.decisions?.evaluate.bind(api.runtime.decisions),
    rubric: () =>
      skillLoader.loadSkillDocument("location-judgment", {
        agentId,
        workspaceDir: workspaceOf(agentId),
      }),
    probabilities: config.likelihood,
    fallback: config.fallbackLikelihood[question] ?? "even",
    timeoutMs: config.judgmentTimeoutMs,
  });
  const placeEvidence = (map: WorldMap, place: Place) => ({
    name: placeLabel(map, place.id),
    summary: place.summary,
    description: place.bodyMarkdown.slice(0, 1200),
  });

  /**
   * Does `agentId` get into a place, the way they are going about it? There is
   * no ownership rule: the place's description says whose it is and how it is
   * kept, and the evidence mirrors Perception's (who is involved, what they are
   * doing, what they are like, and who is there now).
   */
  // Registered after Location; until attached there are no sightings or huddles.
  let perception: Pick<Perception, "receive"> | undefined;
  let conversations: Conversations | undefined;
  const huddlesAt = async (placeId: string): Promise<readonly Huddle[]> =>
    (await conversations?.huddlesAt(placeId)) ?? [];
  const label = async (id: string): Promise<string> =>
    personLabel(await displayName(id), id);
  const nameOfPlace = (id: string | undefined): string | undefined =>
    id === undefined ? undefined : (world?.map.places.get(id)?.name ?? id);

  /** Who stands at a place at `at`, the asker included. */
  const occupants = async (placeId: string, at: number): Promise<string[]> => {
    const here = await Promise.all(
      (await participants()).map(async (id) => {
        const current = await record(id);
        const position = current && positionAt(current, at);
        return position?.kind === "at" && position.placeId === placeId
          ? id
          : undefined;
      }),
    );
    return here.filter((id): id is string => id !== undefined);
  };

  /** Where someone is at `at`: their place, or the place they are passing. */
  const nearAt = async (id: string, at: number) => {
    const current = await record(id);
    const position = current && positionAt(current, at);
    if (!position) return undefined;
    return position.kind === "at"
      ? { placeId: position.placeId, passing: false as const }
      : {
          placeId: position.near,
          passing: true as const,
          from: position.trip.legs.filter((leg) => leg.at <= at).at(-1)
            ?.placeId,
          toward: position.trip.legs.find((leg) => leg.at > at)?.placeId,
        };
  };

  /**
   * A sighting is `sighting|<kind>|<subject>|<place>|<at>`: `cross` (paths
   * cross on the way), `arrive` (the observer walks in on someone), `comes`
   * (someone walks in on the observer), or `meet|…|<between>` (coming opposite
   * ways between two places). It is held in the observer's Perception inbox and
   * judged when it happens.
   */
  const SIGHTING = "sighting";
  const MOMENTS = ["cross", "arrive", "comes", "meet"] as const;
  const sight = async (
    observer: string,
    kind: "cross" | "arrive" | "comes" | "meet",
    subject: string,
    placeId: string,
    at: number,
    between?: string,
  ): Promise<void> => {
    // A human player has no brain to notice with.
    if (!perception || isUser(observer)) return;
    try {
      await perception.receive(observer, {
        id: [
          SIGHTING,
          kind,
          subject,
          placeId,
          at,
          ...(between === undefined ? [] : [between]),
        ].join("|"),
        sessionKey: `agent:${observer}:tasks`,
        sender: subject,
        // Written when it happens, from who is there then.
        text: `${await label(subject)} is here.`,
        timestamp: at,
        foreseen: true,
      });
    } catch (error: unknown) {
      warn(`Location: could not hold a sighting: ${String(error)}`);
    }
  };

  /** Rewrites one participant's noticed set, if they have a record. */
  const setNoticed = async (
    id: string,
    change: (noticed: readonly string[]) => readonly string[],
  ): Promise<void> => {
    const current = await record(id);
    if (!current) return;
    await save(id, {
      ...current,
      noticed: [...new Set(change(current.noticed ?? []))],
    });
  };

  /**
   * Someone goes from a place: out of its huddles (a line to those in them),
   * and seen going by anyone who had noticed them.
   */
  const leave = async (
    who: string,
    placeId: string,
    at: number,
    toward?: string,
  ): Promise<void> => {
    const huddled = new Set(
      (await huddlesAt(placeId))
        .filter(({ members }) => members.includes(who))
        .flatMap(({ members }) => members),
    );
    for (const other of await occupants(placeId, at)) {
      const theirs = await record(other);
      if (other === who || !theirs?.noticed?.includes(who)) continue;
      await setNoticed(other, (noticed) => noticed.filter((id) => id !== who));
      // Those talking with them hear them go in the huddle itself.
      if (huddled.has(other) || isUser(other) || !perception) continue;
      await perception.receive(other, {
        id: ["departure", who, placeId, at].join("|"),
        sessionKey: `agent:${other}:tasks`,
        sender: who,
        text: `${await label(who)} leaves${toward ? `, heading toward ${toward}` : ""}.`,
        timestamp: at,
      });
    }
    await conversations
      ?.leavePlace(who, await displayName(who), placeId, {
        ...(toward ? { toward } : {}),
        at,
      })
      .catch((error: unknown) =>
        warn(`Location: leaving huddles failed: ${String(error)}`),
      );
  };

  /**
   * After a write: what changed for others. Leaving a place takes someone out
   * of its huddles (a line to those in them) and is seen by anyone who had
   * noticed them; arriving is judged both ways round, group by group; and every
   * crossing their new plan makes with others' is foreseen.
   */
  const moved = async (
    who: string,
    current: LocationRecord,
    before: string | undefined,
    at: number,
  ): Promise<void> => {
    if (!world) return;
    const position = positionAt(current, at);
    const after = position.kind === "at" ? position.placeId : undefined;
    const toward = nameOfPlace(
      position.kind === "traveling"
        ? position.trip.legs.find((leg) => leg.at > at)?.placeId
        : after,
    );
    if (before !== undefined && before !== after) {
      await leave(who, before, at, toward);
    }
    if (after !== undefined && after !== before) {
      const others = (await occupants(after, at)).filter((id) => id !== who);
      const huddles = await huddlesAt(after);
      const inHuddle = new Set(huddles.flatMap(({ members }) => members));
      // The arriver may notice each group there; one sighting per group.
      for (const { members } of huddles) {
        const present = members.filter((id) => others.includes(id)).sort();
        if (present[0]) await sight(who, "arrive", present[0], after, at);
      }
      for (const other of others) {
        if (!inHuddle.has(other)) await sight(who, "arrive", other, after, at);
        // Each of them may notice the newcomer.
        await sight(other, "comes", who, after, at);
      }
    }
    const windowMs = config.passWindowMinutes * 60_000;
    for (const other of await participants()) {
      if (other === who) continue;
      const theirs = await record(other);
      if (!theirs) continue;
      for (const crossing of crossings(
        { id: who, record: current },
        { id: other, record: theirs },
        at,
        windowMs,
      )) {
        await sight(
          crossing.observer,
          crossing.between === undefined ? "cross" : "meet",
          crossing.subject,
          crossing.placeId,
          crossing.at,
          crossing.between,
        );
      }
    }
  };

  /** "Airi `kurimura-airi` and Natsu `yutori-natsu`, talking (chat:huddle:…)". */
  const groupLabel = async (
    members: readonly string[],
    huddle?: string,
  ): Promise<string> => {
    const names = await Promise.all(members.map(label));
    const listed =
      names.length <= 1
        ? (names[0] ?? "")
        : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    return huddle ? `${listed}, talking (${huddle})` : listed;
  };

  /**
   * A sighting's moment has come. Are they still there? Does the observer
   * notice them? Someone talking in a huddle is seen with the whole huddle,
   * judged once as a group ("do you notice Airi and Natsu, talking?"), and the
   * sighting carries the huddle's address so the observer can join it. A
   * sighting is written to the observer's `:tasks` ledger and returned as what
   * actually happened.
   */
  const confirm = async (
    observer: string,
    item: Stimulus,
  ): Promise<Stimulus | undefined> => {
    if (!world) return undefined;
    const [prefix, rawKind, subject, placeId, , betweenId] = item.id.split("|");
    const place = placeId ? world.map.places.get(placeId) : undefined;
    const kind = MOMENTS.find((moment) => moment === rawKind);
    if (prefix !== SIGHTING || !kind || !subject || !place) return undefined;
    const between =
      kind === "meet" && betweenId
        ? world.map.places.get(betweenId)
        : undefined;
    if (kind === "meet" && !between) return undefined;
    const at = item.timestamp;
    // Nobody sees an offstage character, and an offstage observer saw nothing.
    if (
      deps.stage &&
      !(
        (await deps.stage.presentAt(observer, at)) &&
        (await deps.stage.presentAt(subject, at)) &&
        (await deps.stage.isOnstage(subject))
      )
    )
      return undefined;
    const [mine, theirs] = await Promise.all([
      nearAt(observer, at),
      nearAt(subject, at),
    ]);
    if (!mine || !theirs) return undefined;
    if (between) {
      // Still walking that stretch, toward each other.
      const ends = new Set([place.id, between.id]);
      if (
        !mine.passing ||
        !theirs.passing ||
        !ends.has(mine.from ?? "") ||
        !ends.has(mine.toward ?? "") ||
        theirs.from !== mine.toward ||
        theirs.toward !== mine.from
      ) {
        return undefined;
      }
    } else if (mine.placeId !== place.id || theirs.placeId !== place.id) {
      return undefined;
    }
    const huddle =
      kind === "comes" || between
        ? undefined
        : (await huddlesAt(place.id)).find(({ members }) =>
            members.includes(subject),
          );
    if (huddle?.members.includes(observer)) return undefined;
    const present = huddle
      ? (
          await Promise.all(
            huddle.members.map(async (id) =>
              (await nearAt(id, at))?.placeId === place.id ? id : undefined,
            ),
          )
        )
          .filter((id): id is string => id !== undefined)
          .sort()
      : [subject];
    // One sighting per group: its first member stands for it.
    if (present[0] !== subject) return undefined;
    const already = (await record(observer))?.noticed ?? [];
    if (!mine.passing && present.every((id) => already.includes(id))) {
      return undefined;
    }
    const workspace = workspaceOf(observer);
    const impressionOf = (id: string): string | null => {
      if (!workspace) return null;
      const card = path.join(
        workspace,
        "wiki",
        "entities",
        "characters",
        `${id.replace(/^user:/u, "")}.md`,
      );
      return existsSync(card) ? excerpt(readFileSync(card, "utf8"), 600) : null;
    };
    const judgment = await judge(judgeWith(observer, "notice"), {
      agentId: observer,
      question: "notice",
      seed: ["notice", observer, ...present, place.id, at],
      state: {
        simulationTime: formatSimTime(at),
        place: placeEvidence(world.map, place),
        moment:
          kind === "comes"
            ? "they just came in"
            : kind === "arrive"
              ? "the observer just came in"
              : between
                ? `they pass each other going opposite ways, on the way between ${place.name} and ${between.name}`
                : "their paths cross here",
        observer: {
          ...(await person(world.map, observer, at)),
          passingThrough: mine.passing,
        },
        others: await Promise.all(
          present.map(async (id) => ({
            ...(await person(world.map, id, at)),
            passingThrough: (await nearAt(id, at))?.passing ?? false,
            whatTheObserverKnowsOfThem: impressionOf(id),
          })),
        ),
        talkingTogether: huddle !== undefined && present.length > 1,
      },
    });
    if (!judgment.happens) return undefined;
    const who = await groupLabel(present, huddle?.address);
    const passes = present.length > 1 ? "pass" : "passes";
    const toward = nameOfPlace(theirs.passing ? theirs.toward : undefined);
    const text = between
      ? `On the way between ${place.name} and ${between.name}, you pass ${who} going the other way.`
      : kind === "comes"
        ? `${await label(subject)} comes in.`
        : kind === "arrive"
          ? `You see ${who} here.`
          : !mine.passing
            ? `${who} ${passes} through ${place.name}${toward ? `, heading toward ${toward}` : ""}.`
            : theirs.passing
              ? `On your way through ${place.name}, you notice ${who} passing too.`
              : `On your way through ${place.name}, you notice ${who} there.`;
    // `noticed` is who they know is here now. Someone only passing through is
    // gone a moment later: the sighting is the whole event, and if they come
    // back and stop, that arrival is noticed afresh.
    if (!mine.passing && !theirs.passing) {
      await setNoticed(observer, (noticed) => [...noticed, ...present]);
    }
    const payload = {
      subjects: present,
      placeId: place.id,
      moment: kind,
      ...(between ? { between: between.id } : {}),
      ...(huddle ? { huddle: huddle.address } : {}),
      word: judgment.word,
      probability: judgment.probability,
      roll: judgment.roll,
      source: judgment.source,
    };
    await appendLedger({
      agentId: observer,
      text,
      timestamp: at,
      metadata: { kind: "location.noticed", payload },
    });
    broadcaster?.broadcast({
      type: "journal",
      event: {
        seq: nextJournalSeq(),
        simTime: at,
        kind: "location.noticed",
        actors: [observer],
        placeId: place.id,
        payload,
      },
    });
    return { ...item, text };
  };

  const taskExtension: TaskExtension | undefined = world && {
    startTaskParameters: { where: whereParameter(config) },
    delayTaskParameters: {},
    required: ["where"],
    async prepare(transition) {
      const where = transition.params.where;
      if (
        transition.kind === "started" &&
        (typeof where !== "string" || where.trim() === "")
      ) {
        throw new Error("`where` names where this activity happens.");
      }
      const { agentId, at } = transition;
      const current = await record(agentId);
      // Where they have been until now; moving on means they took it in.
      const standing = current ? positionAt(current, at) : undefined;
      const move = await planTransition(
        world.map,
        current,
        transition,
        typeof where === "string" ? where : "",
        config.travelCategories,
      );
      return {
        ...(move.note === undefined ? {} : { note: move.note }),
        ...(move.payload === undefined ? {} : { payload: move.payload }),
        // Every arrival is a lease's end: a trip's own, or the check-in a walk
        // over asks for. One wake per arrival.
        ...(move.checkInAt === undefined ? {} : { checkInAt: move.checkInAt }),
        async commit(): Promise<void> {
          if (!move.record) return;
          const before = standing?.kind === "at" ? standing.placeId : undefined;
          const after = positionAt(move.record, at);
          // Staying put keeps what they have noticed here; moving clears it.
          const stays = after.kind === "at" && after.placeId === before;
          await save(agentId, {
            ...move.record,
            ...(stays && current?.noticed ? { noticed: current.noticed } : {}),
          });
          if (before !== undefined) await remember(agentId, before, at);
          await moved(agentId, move.record, before, at);
        },
      };
    },
  };

  /**
   * Known places are the character's cards. Places named in this turn's input
   * or in their own `MEMORY.md` (plans, promises) come to mind first, heard of
   * or not; card aliases count as names.
   */
  const knowledge = async (
    map: WorldMap,
    agentId: string,
    evidence: string,
  ): Promise<PlaceKnowledge> => {
    const cards = await cardsOf(agentId);
    const workspace = workspaceOf(agentId);
    const memory = workspace
      ? ((await readCharacterFiles(workspace)).memory ?? "")
      : "";
    const namedIn = (text: string): string[] => {
      const lower = text.toLowerCase();
      return [
        ...placesNamedIn(map, text),
        ...cards
          .filter(({ aliases }) =>
            aliases.some(
              (alias) =>
                alias.length >= 3 && lower.includes(alias.toLowerCase()),
            ),
          )
          .map(({ placeId }) => placeId),
      ];
    };
    return {
      known: new Set(cards.map(({ placeId }) => placeId)),
      named: [...new Set([...namedIn(evidence), ...namedIn(memory)])].filter(
        (id) => map.places.has(id),
      ),
    };
  };

  /**
   * Puts someone at a place now: no travel, no ledger row. Leaving and arriving
   * are seen like any move. Standing there already changes nothing.
   */
  const place = async (
    id: string,
    placeId: string,
  ): Promise<LocationRecord> => {
    if (!everyone().includes(id)) throw new Error(`No participant ${id}.`);
    if (!world?.map.places.has(placeId))
      throw new Error(`No place called ${placeId}.`);
    await clock.init();
    const at = clock.time();
    const previous = await record(id);
    const was = previous && positionAt(previous, at);
    if (previous && was?.kind === "at" && was.placeId === placeId)
      return previous;
    const placed: LocationRecord = { placeId, since: at };
    await save(id, placed);
    await moved(id, placed, was?.kind === "at" ? was.placeId : undefined, at);
    return placed;
  };

  // Operator placement. Characters otherwise move only through their own
  // tasks; the player, who has none, moves through `POST /kazusa/move`.
  api.registerGatewayMethod("location.place", async ({ params, respond }) => {
    const parsed = z
      .object({ id: z.string(), placeId: z.string() })
      .safeParse(params);
    if (!parsed.success) {
      respond(false, undefined, {
        code: "INVALID_ARGUMENT",
        message: "id must name a participant and placeId a place",
      });
      return;
    }
    const { id } = parsed.data;
    let placed: LocationRecord;
    try {
      placed = await place(id, parsed.data.placeId);
    } catch (error: unknown) {
      respond(false, undefined, {
        code: "INVALID_ARGUMENT",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const at = clock.time();
    respond(
      true,
      { id, at, record: placed, position: positionAt(placed, at) },
      undefined,
    );
  });

  return {
    ...(world ? { world } : {}),
    ...(taskExtension ? { taskExtension } : {}),
    record,
    participants,
    place,
    exit: async (id, at) => {
      if (!world) return;
      const current = await record(id);
      if (!current) return;
      const position = positionAt(current, at);
      if (position.kind === "at") await leave(id, position.placeId, at);
      if (current.noticed?.length) await save(id, { ...current, noticed: [] });
    },
    enter: async (id, at) => {
      if (!world) return;
      const current = await record(id);
      if (!current) return;
      // Observers dropped them while they were away; this brings them back.
      await save(id, current);
      await moved(id, current, undefined, at);
    },
    whereabouts: async (agentId, at, evidence) => {
      if (!world) return undefined;
      const current = await record(agentId);
      const position = current && positionAt(current, at);
      // With you: who they have noticed here, and anyone talking with them.
      let company: Companion[] = [];
      let ownHuddle: string | undefined;
      if (position?.kind === "at") {
        const here = await occupants(position.placeId, at);
        const huddles = await huddlesAt(position.placeId);
        ownHuddle = huddles.find(({ members }) =>
          members.includes(agentId),
        )?.address;
        const huddleOf = (id: string) =>
          huddles.find(({ members }) => members.includes(id))?.address;
        const known = new Set([
          ...(current?.noticed ?? []),
          ...(huddles.find(({ address }) => address === ownHuddle)?.members ??
            []),
        ]);
        company = await Promise.all(
          here
            .filter((id) => id !== agentId && known.has(id))
            .map(async (id) => {
              const task = await tasks.lookup(id);
              const huddle = huddleOf(id);
              return {
                id,
                name: await displayName(id),
                ...(task ? { activity: task.type } : {}),
                ...(huddle ? { huddle } : {}),
              };
            }),
        );
      }
      return renderWhereabouts(
        world.map,
        current,
        at,
        await knowledge(world.map, agentId, evidence),
        config.listLimit,
        company,
        ownHuddle,
      );
    },
    settle: async (agentId) => {
      const stored = await store.lookup(agentId);
      const arrival =
        stored && world && arrive(world.map, stored, clock.time());
      if (!arrival) return undefined;
      await save(agentId, arrival.record);
      await moved(agentId, arrival.record, undefined, arrival.record.since);
      return arrival.note;
    },
    inCompany: async (agentId, at) => {
      const current = await record(agentId);
      const position = current && positionAt(current, at);
      if (position?.kind !== "at") return false;
      const here = await occupants(position.placeId, at);
      const talking = (await huddlesAt(position.placeId)).some(({ members }) =>
        members.includes(agentId),
      );
      return (
        talking ||
        here.some(
          (id) => id !== agentId && (current?.noticed ?? []).includes(id),
        )
      );
    },
    placeOf: async (id) => {
      if (!world) return undefined;
      // Nobody can speak to someone offstage, nor they to anyone.
      if (deps.stage && !(await deps.stage.isOnstage(id))) return undefined;
      await clock.init();
      const current = await record(id);
      const position = current && positionAt(current, clock.time());
      return position?.kind === "at"
        ? {
            placeId: position.placeId,
            title:
              world.map.places.get(position.placeId)?.name ?? position.placeId,
          }
        : undefined;
    },
    attachConversations: (target) => {
      conversations = target;
    },
    attachPerception: (target) => {
      perception = target;
    },
    confirm,
  };
}
