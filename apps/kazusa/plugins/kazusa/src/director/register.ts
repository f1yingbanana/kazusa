import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { Clock } from "../clock/clock.ts";
import { formatSimTime } from "../context-engine/format.ts";
import { currentConfig } from "../current-config.ts";
import { characterName } from "../identity.ts";
import { plansOn } from "../memory/writes.ts";
import type { KazusaRealtimeBroadcaster } from "../realtime.ts";
import { pluginSkillText } from "../skill-text.ts";
import type { Stimulus } from "../stimulus.ts";
import {
  digestOf,
  happeningOf,
  recordHappening,
  sharedHappenings,
  watchingIn,
  type Watch,
} from "./director.ts";

/** The fewest sim minutes between two cues about one character. */
const CUE_GAP_MS = 10 * 60_000;
/** How many happenings one digest lists, at most. */
const DIGEST_LINES = 60;
/** How far back a watched character's chats count as their scene. */
const SCENE_WINDOW_MS = 90 * 60_000;
/** How much of each onstage character's activity the cast overview shows. */
const CAST_DOING = 70;
/** How many characters `cast` shows in depth at once. */
const CAST_DEPTH = 8;
const DAY_MS = 24 * 60 * 60_000;
/** How many of a watched conversation's latest lines the director reads. */
const SCENE_LINES = 6;
/** How far back a first digest looks, with no look before it. */
const FIRST_LOOK_MS = 60 * 60_000;

export interface DirectorService {
  /** What the director is watching this character for, if it is. */
  readonly watching: (agentId: string) => Promise<Watch | undefined>;
  /**
   * A watched character's moment, in the lines that just reached them: the
   * director hears of it, at most once per character in `CUE_GAP_MS`.
   */
  readonly cue: (agentId: string, lines: string) => Promise<void>;
  /**
   * For the director's activity check-in: what happened in the world since it
   * last looked. Nothing for anyone else.
   */
  readonly digest: (agentId: string) => Promise<string | undefined>;
  /**
   * For the director's own turns: each character it watches as they are now
   * (where, doing what, with whom). Nothing for anyone else.
   */
  readonly view: (agentId: string) => Promise<string | undefined>;
  /**
   * For the director's own turns: the `world-director` skill, on every turn, so
   * its rules are in front of it when a request comes in and at every look and
   * cue, not only on the turn it read them.
   */
  readonly guide: (agentId: string) => Promise<string | undefined>;
}

const SUBSCRIBED = Symbol.for("kazusa.director.subscribed");
/** Who narration comes from: no character, never a member of a chat. */
export const NARRATOR = "narrator";
/** The system agent's skill for directing, read into its turns while it does. */
const DIRECTOR_SKILL = "world-director";

/**
 * The director: the system agent keeps the world's arcs in its `MEMORY.md` and
 * steers by planting ideas in characters' own `MEMORY.md` (no code) and by
 * narrating. Code gives it what it can't see: the cast; a digest of what
 * happened with each check-in of its own activities; the few characters its
 * notebook's settings block names (`watching:`), with a cue when the moment it
 * watches for comes up. Whether a scene went as scripted is its own judgment.
 * `references/director.md`.
 */
export function registerDirector(
  api: OpenClawPluginApi,
  deps: {
    readonly clock: Pick<Clock, "time">;
    readonly broadcaster: KazusaRealtimeBroadcaster;
    /** Hands a stimulus to an agent's brain, as Perception does. */
    readonly receive: (agentId: string, stimulus: Stimulus) => Promise<void>;
    /** The conversation in person a character is in, if any. */
    readonly huddleOf?: (
      agentId: string,
    ) => Promise<
      { readonly id: string; readonly members: readonly string[] } | undefined
    >;
    /** Where a character is. */
    readonly placeOf?: (
      agentId: string,
    ) => Promise<
      { readonly placeId: string; readonly title?: string } | undefined
    >;
    /** The latest lines of a conversation, oldest first. */
    readonly latest?: (
      chatId: string,
      limit: number,
    ) => Promise<readonly string[]>;
    /**
     * The chats these characters sent or received in since `since`, newest
     * first: where their scenes are, texting included.
     */
    readonly recentChats?: (
      agentIds: readonly string[],
      since: number,
    ) => Promise<readonly string[]>;
    /** Whether a character is simulated now. */
    readonly onstage?: (agentId: string) => Promise<boolean>;
    /** What a character is doing. */
    readonly activity?: (agentId: string) => Promise<
      | {
          readonly type: string;
          readonly description: string;
          readonly endAt?: string;
        }
      | undefined
    >;
    /** Narration into a conversation from outside it (`Messaging.narrate`). */
    readonly narrate?: (
      chatId: string,
      narrator: { readonly id: string; readonly name: string },
      text: string,
      requestId: string,
    ) => Promise<{ readonly members: readonly string[] } | undefined>;
  },
): DirectorService {
  const text = pluginSkillText(api);
  const looks = api.runtime.state.openKeyedStore<{ readonly at: number }>({
    namespace: "director",
    retention: "retained",
  });
  const happenings = sharedHappenings();
  const scope = globalThis as { [SUBSCRIBED]?: boolean };
  if (!scope[SUBSCRIBED]) {
    scope[SUBSCRIBED] = true;
    deps.broadcaster.subscribe((event) => {
      if (event.type !== "journal") return;
      const happening = happeningOf(event.event);
      if (happening) recordHappening(happenings, happening);
    });
  }

  const director = () =>
    currentConfig(api).agents?.defaults?.systemAgent?.agentId;

  const workspace = (id: string) =>
    api.runtime.agent.resolveAgentWorkspaceDir(currentConfig(api), id);
  // The notebook, read again only when it changed on disk.
  let cached:
    | {
        file: string;
        mtime: number;
        watches: Watch[];
      }
    | undefined;
  const notebook = async () => {
    const id = director();
    if (!id) return undefined;
    const file = path.join(workspace(id), "MEMORY.md");
    try {
      const { mtimeMs } = await stat(file);
      if (cached?.file !== file || cached.mtime !== mtimeMs) {
        const text = await readFile(file, "utf8");
        cached = {
          file,
          mtime: mtimeMs,
          watches: watchingIn(text),
        };
      }
      return cached;
    } catch {
      return undefined;
    }
  };
  const watches = async (): Promise<Watch[]> =>
    (await notebook())?.watches ?? [];

  // The director's skill, where the system agent's own skills are, read again
  // only when it changed. Without its front matter.
  let skill: { file: string; mtime: number; body: string } | undefined;
  const skillText = async (id: string): Promise<string | undefined> => {
    for (const dir of [".agents/skills", "skills"]) {
      const file = path.join(workspace(id), dir, DIRECTOR_SKILL, "SKILL.md");
      try {
        const { mtimeMs } = await stat(file);
        if (skill?.file !== file || skill.mtime !== mtimeMs)
          skill = {
            file,
            mtime: mtimeMs,
            body: (await readFile(file, "utf8"))
              .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
              .trim(),
          };
        return skill.body;
      } catch {
        // Not here; the next place.
      }
    }
    return undefined;
  };

  const names = new Map<string, string>();
  const nameOf = async (agentId: string) => {
    let name = names.get(agentId);
    if (!name) {
      name = await characterName(api, currentConfig(api), agentId).catch(
        () => agentId,
      );
      names.set(agentId, name);
    }
    return name;
  };
  const clockOf = (at: number) => new Date(at).toISOString().slice(11, 16);

  const lastCue = new Map<string, number>();

  /** The world's characters, the director aside. */
  const roster = () =>
    listAgentIds(currentConfig(api)).filter((id) => id !== director());
  const onstage = async (id: string) =>
    deps.onstage ? await deps.onstage(id).catch(() => true) : true;
  const shortly = (text: string, max: number) =>
    text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

  /** Everyone onstage, by place, each with what they're doing. */
  const castView = async (id: string): Promise<string | undefined> => {
    const rows = await Promise.all(
      roster().map(async (who) => ({
        who,
        on: await onstage(who),
        at: await deps.placeOf?.(who).catch(() => undefined),
        task: await deps.activity?.(who).catch(() => undefined),
      })),
    );
    const on = rows.filter((row) => row.on);
    if (!on.length && rows.length === 0) return undefined;
    const places = new Map<string, string[]>();
    for (const row of on) {
      const key = row.at
        ? `${row.at.title ?? row.at.placeId} (${row.at.placeId})`
        : "-";
      const doing = row.task
        ? `: ${row.task.type}, ${shortly(row.task.description, CAST_DOING)}`
        : "";
      places.set(key, [
        ...(places.get(key) ?? []),
        `${await nameOf(row.who)} (${row.who})${doing}`,
      ]);
    }
    const lines = [...places].map(
      ([place, people]) => `- ${place}: ${people.join("; ")}`,
    );
    return text(
      "kazusa-director#cast",
      {
        lines: lines.join("\n") || "-",
        offstage: String(rows.length - on.length),
      },
      { agentId: id },
    );
  };

  /** One character in full, for `cast`: where, doing what, with whom, plans. */
  const castDetail = async (who: string): Promise<string> => {
    const name = `${await nameOf(who)} (${who})`;
    if (!roster().includes(who))
      return text("kazusa-director#watching-unknown", { who: name }, {});
    const [on, at, task, huddle] = await Promise.all([
      onstage(who),
      deps.placeOf?.(who).catch(() => undefined),
      deps.activity?.(who).catch(() => undefined),
      deps.huddleOf?.(who).catch(() => undefined),
    ]);
    const chat =
      huddle?.id ??
      (
        await deps
          .recentChats?.([who], deps.clock.time() - SCENE_WINDOW_MS)
          .catch(() => [])
      )?.[0];
    const said = chat
      ? ((await deps.latest?.(chat, SCENE_LINES).catch(() => [])) ?? [])
      : [];
    let memory = "";
    try {
      memory = await readFile(path.join(workspace(who), "MEMORY.md"), "utf8");
    } catch {
      // No memory file yet: no plans.
    }
    const plans = [0, 1, 2].flatMap((days) => {
      const date = new Date(deps.clock.time() + days * DAY_MS)
        .toISOString()
        .slice(0, 10);
      return plansOn(memory, date).map((plan) => `${date}: ${plan}`);
    });
    const company = (huddle?.members ?? []).filter((one) => one !== who);
    return [
      `## ${name}${on ? "" : " (offstage)"}`,
      `- At: ${at ? `${at.title ?? at.placeId} (${at.placeId})` : "-"}`,
      `- Doing: ${task ? `${task.type}: ${task.description}${task.endAt ? ` (until ${clockOf(Date.parse(task.endAt))})` : ""}` : "-"}`,
      `- With: ${company.length ? (await Promise.all(company.map(async (one) => (one.startsWith("user:") ? one : `${await nameOf(one)} (${one})`)))).join(", ") : "nobody, not in a conversation"}`,
      `- Plans, today and the next two days:${plans.length ? `\n${plans.map((plan) => `  - ${shortly(plan, 400)}`).join("\n")}` : " none written down"}`,
      `- Latest lines${chat ? ` (${chat})` : ""}:${said.length ? `\n${said.map((line) => `  > ${shortly(line, 300)}`).join("\n")}` : " none lately"}`,
    ].join("\n");
  };

  // The director's view of anyone in the cast, in depth.
  api.registerTool({
    name: "cast",
    label: "Cast",
    description:
      "As the world's director: look at the cast. With no arguments, everyone onstage by place with what each is doing. With `who` (character ids) or `place` (a place id), each of those characters in depth: where they are, what they are doing and until when, who they are with, their plans for today and the next two days, and the latest lines of their conversation. Use it when planning a story or timing a scene.",
    parameters: {
      type: "object",
      properties: {
        who: {
          type: "array",
          items: { type: "string" },
          description: "Character ids to look at in depth, eight at most.",
        },
        place: {
          type: "string",
          description: "A place id: everyone there, in depth.",
        },
      },
      additionalProperties: false,
    },
    async execute(_id, params: { who?: unknown; place?: unknown }) {
      const reply = (message: string) => ({
        content: [{ type: "text" as const, text: message }],
        details: {},
      });
      const id = director();
      if (!id) return reply("No system agent in this world.");
      let who = Array.isArray(params.who)
        ? params.who.filter((one): one is string => typeof one === "string")
        : [];
      if (typeof params.place === "string" && params.place) {
        const here = await Promise.all(
          roster().map(async (one) => ({
            one,
            at: await deps.placeOf?.(one).catch(() => undefined),
          })),
        );
        who = [
          ...who,
          ...here
            .filter((row) => row.at?.placeId === params.place)
            .map((row) => row.one),
        ];
      }
      if (!who.length) return reply((await castView(id)) ?? "No cast.");
      const details = await Promise.all(
        [...new Set(who)].slice(0, CAST_DEPTH).map(castDetail),
      );
      return reply(details.join("\n\n"));
    },
  });

  /** One character as they are now, in the director's words. */
  const lineOf = async (agentId: string, why?: string): Promise<string> => {
    const who = `${await nameOf(agentId)} (${agentId})`;
    if (!listAgentIds(currentConfig(api)).includes(agentId))
      return text("kazusa-director#watching-unknown", { who }, {});
    if (deps.onstage && !(await deps.onstage(agentId).catch(() => true)))
      return text("kazusa-director#watching-offstage", { who }, {});
    const [at, task, huddle] = await Promise.all([
      deps.placeOf?.(agentId).catch(() => undefined),
      deps.activity?.(agentId).catch(() => undefined),
      deps.huddleOf?.(agentId).catch(() => undefined),
    ]);
    const others = (huddle?.members ?? []).filter((one) => one !== agentId);
    // In person if they are, else the chat they were last in, if lately.
    const chat =
      huddle?.id ??
      (
        await deps
          .recentChats?.([agentId], deps.clock.time() - SCENE_WINDOW_MS)
          .catch(() => [])
      )?.[0];
    const said = chat
      ? await deps.latest?.(chat, SCENE_LINES).catch(() => [])
      : undefined;
    const company = others.length
      ? text(
          "kazusa-director#with",
          {
            people: (
              await Promise.all(
                others.map(async (one) =>
                  one.startsWith("user:")
                    ? one
                    : `${await nameOf(one)} (${one})`,
                ),
              )
            ).join(", "),
          },
          {},
        )
      : text("kazusa-director#alone", {}, {});
    const line = text(
      "kazusa-director#watching-line",
      {
        who,
        place: at ? `${at.title ?? at.placeId} (${at.placeId})` : "-",
        activity: task ? `${task.type}: ${task.description}` : "-",
        company,
        for: why ?? "-",
      },
      {},
    );
    return said?.length
      ? [line, ...said.map((one) => `  > ${one.slice(0, 300)}`)].join("\n")
      : line;
  };

  // The director's voice in a scene: what happens around the people in it.
  api.registerTool({
    name: "narrate",
    label: "Narrate",
    description:
      "As the world's director (read the world-director skill before directing), narrate something that happens where a character is now: at their place, never somewhere else. Everyone in the conversation they are in hears it as the narrator's line (the user sees it too); a character on their own notices it. Narrate only what nobody present does or says: weather, a sound, an object, a passer-by, news arriving. Never the words or actions of a character who is there, or of the user. It is real to them but changes nothing else: no place, time or state.",
    parameters: {
      type: "object",
      properties: {
        who: {
          type: "string",
          description: "A character in the scene, by id.",
        },
        text: {
          type: "string",
          description: "What happens, as narration, in the present tense.",
        },
        aside: {
          type: "boolean",
          description:
            "Only this character perceives it: a feeling, an impulse, a memory surfacing, told to them in the second person, even while they are in a conversation. Never a decision, never their words.",
        },
      },
      required: ["who", "text"],
      additionalProperties: false,
    },
    async execute(
      _id,
      params: { who?: unknown; text?: unknown; aside?: unknown },
    ) {
      const who = typeof params.who === "string" ? params.who.trim() : "";
      const line =
        typeof params.text === "string"
          ? params.text.replace(/\s+/g, " ").trim().slice(0, 1_000)
          : "";
      const reply = (message: string) => ({
        content: [{ type: "text" as const, text: message }],
        details: {},
      });
      const config = currentConfig(api);
      if (!line) return reply("Nothing to narrate.");
      if (!who || who === director() || !listAgentIds(config).includes(who))
        return reply(`No character "${who}".`);
      if (deps.onstage && !(await deps.onstage(who).catch(() => true)))
        return reply(
          `${who} is offstage: nothing reaches them until they are back. Work through someone onstage.`,
        );
      const now = deps.clock.time();
      const narrator = {
        id: NARRATOR,
        name: text("kazusa-director#narrator", {}, {}),
      };
      const aside = params.aside === true;
      const huddle = aside ? undefined : await deps.huddleOf?.(who);
      if (huddle && deps.narrate) {
        const told = await deps.narrate(
          huddle.id,
          narrator,
          line,
          `narrate-${now}-${who}`,
        );
        api.logger.info(`Director: narrated into ${huddle.id}`);
        return reply(
          `Narrated to ${(told?.members ?? []).join(", ") || huddle.id}. ${await lineOf(who)}`,
        );
      }
      await deps.receive(who, {
        id: `${aside ? "aside" : "narrate"}:${who}:${now}`,
        sessionKey: `agent:${who}:tasks`,
        sender: NARRATOR,
        senderName: narrator.name,
        text: line,
        timestamp: now,
      });
      api.logger.info(
        `Director: ${aside ? "aside to" : "narrated to"} ${who}, on their own`,
      );
      return reply(
        `${aside ? "Told only" : "Narrated to"} ${who}. ${await lineOf(who)}`,
      );
    },
  });

  return {
    async watching(agentId) {
      if (agentId === director()) return undefined;
      return (await watches()).find((watch) => watch.who === agentId);
    },

    async cue(agentId, lines) {
      const id = director();
      const watch = (await watches()).find((w) => w.who === agentId);
      if (!id || !watch) return;
      const now = deps.clock.time();
      const last = lastCue.get(agentId);
      if (last !== undefined && now - last < CUE_GAP_MS) return;
      lastCue.set(agentId, now);
      api.logger.info(`Director: cue for ${agentId}`);
      await deps.receive(id, {
        id: `director-cue:${agentId}:${now}`,
        sessionKey: `agent:${id}:tasks`,
        sender: "kazusa:director",
        text: text(
          "kazusa-director#cue",
          {
            who: `${await nameOf(agentId)} (${agentId})`,
            for: watch.for ?? "-",
            time: clockOf(now),
            lines: lines.slice(0, 4_000),
            now: await lineOf(agentId, watch.for),
          },
          { agentId: id },
        ),
        timestamp: now,
      });
    },

    async guide(agentId) {
      const id = director();
      if (!id || agentId !== id) return undefined;
      return skillText(id);
    },

    async view(agentId) {
      const id = director();
      if (!id || agentId !== id) return undefined;
      const watched = await watches();
      const cast = await castView(id);
      // Even watching nobody, its turns name how to direct.
      if (!watched.length)
        return [
          cast,
          text("kazusa-director#watching-none", {}, { agentId: id }),
        ]
          .filter(Boolean)
          .join("\n\n");
      const lines = await Promise.all(
        watched.map((watch) => lineOf(watch.who, watch.for)),
      );
      return [
        cast,
        text(
          "kazusa-director#watching",
          { lines: lines.join("\n") },
          { agentId: id },
        ),
      ]
        .filter(Boolean)
        .join("\n\n");
    },

    async digest(agentId) {
      const id = director();
      if (!id || agentId !== id) return undefined;
      const now = deps.clock.time();
      const since = (await looks.lookup(id))?.at ?? now - FIRST_LOOK_MS;
      await looks.register(id, { at: now });
      const { shown, more } = digestOf(happenings, {
        since,
        until: now,
        watched: new Set((await watches()).map((watch) => watch.who)),
        skip: new Set([id]),
        limit: DIGEST_LINES,
      });
      const say = (section: string, values: Record<string, string>) =>
        text(`kazusa-director#${section}`, values, { agentId: id });
      if (!shown.length)
        return say("digest-quiet", { since: formatSimTime(since) });
      const lines = await Promise.all(
        shown.map(async (happening) =>
          say(
            happening.kind === "delayed"
              ? "digest-delayed"
              : happening.where
                ? "digest-line-at"
                : "digest-line",
            {
              time: clockOf(happening.at),
              who: `${await nameOf(happening.who)} (${happening.who})`,
              what: happening.text,
              where: happening.where ?? "",
            },
          ),
        ),
      );
      return say("digest", {
        since: formatSimTime(since),
        happenings: [
          ...lines,
          ...(more ? [say("digest-more", { count: String(more) })] : []),
        ].join("\n"),
      });
    },
  };
}
