import {
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parseEnv } from "node:util";
import { PROVIDERS, type ProviderEntry } from "@kazusa/client";
import { z } from "zod";
import { writeTemplateSnapshot } from "./template-snapshot";

/**
 * Where a world's config includes its system agent's tools and skills from;
 * `scripts/system-agent.mjs` rewrites that file before every Gateway start.
 */
export const SYSTEM_AGENT_INCLUDE = "./.state/kazusa/system-agent.json";

/**
 * First-run setup. `worlds/<id>` are read-only templates; the player's world is
 * a copy in `world/`, so playing never touches the repo. Every step can run
 * again, and `openclaw.json` is written last: its existence means setup is done
 * and is what starts the Gateway (`scripts/dev.mjs`).
 */
export const OPENROUTER_KEY = "OPENROUTER_API_KEY";

/** A provider the setup guide offers a key for, from the shared catalog. */
export type SetupProvider = Pick<
  ProviderEntry,
  "id" | "label" | "hint" | "keysUrl"
>;

const setupProvider = (id: string): SetupProvider | undefined => {
  const entry = PROVIDERS.find((candidate) => candidate.id === id);
  return (
    entry && {
      id: entry.id,
      label: entry.label,
      ...(entry.hint ? { hint: entry.hint } : {}),
      ...(entry.keysUrl ? { keysUrl: entry.keysUrl } : {}),
    }
  );
};

/**
 * Which providers the guide offers, in order: Kazusa's `models.providers`,
 * which also decides whose key runs the world's starting model (the plugin's
 * `models/config.ts`).
 */
const OfferedSchema = z.object({
  models: z.object({ providers: z.array(z.string()).default([]) }).prefault({}),
});

/**
 * Where the live world keeps provider keys: OpenClaw auth profiles, named
 * `<provider>:manual` as the plugin names them (`providers/keys.ts`).
 */
export interface KeyStore {
  /** Providers with a key saved by Kazusa. */
  readonly saved: () => Promise<readonly string[]>;
  readonly set: (provider: string, key: string) => Promise<void>;
}

const ProfileIdsSchema = z.array(z.string());

/**
 * Arguments that run `body` in a child Node process with OpenClaw's SDK at
 * `sdk` as `sdk`. It's imported by `file://` URL: Node reads a bare Windows
 * path's drive (`Z:`) as a URL scheme and refuses it, which stopped setup on
 * every Windows install.
 */
export function sdkScript(
  sdk: string,
  body: string,
  windows = process.platform === "win32",
): string[] {
  const url = pathToFileURL(sdk, { windows }).href;
  return [
    "--input-type=module",
    "-e",
    `const sdk = await import(${JSON.stringify(url)});\n${body}`,
  ];
}

/**
 * Through OpenClaw's plugin SDK in a child Node process, with the world's
 * state: setup runs before the Gateway exists. About a second a call.
 */
export function sdkKeyStore(appDir: string): KeyStore {
  const liveDir = path.join(appDir, "world");
  const sdk = path.join(
    appDir,
    "../../node_modules/openclaw/dist/plugin-sdk/provider-auth.js",
  );
  const options = {
    cwd: liveDir,
    env: {
      ...process.env,
      OPENCLAW_CONFIG_PATH: path.join(liveDir, "openclaw.json"),
      OPENCLAW_STATE_DIR: path.join(liveDir, ".state"),
    },
  };
  const script = (body: string) => sdkScript(sdk, body);
  return {
    saved: async () => {
      if (!existsSync(options.env.OPENCLAW_STATE_DIR)) return [];
      const { stdout } = await promisify(execFile)(
        process.execPath,
        script(
          "process.stdout.write(JSON.stringify(Object.keys(sdk.ensureAuthProfileStore().profiles)));",
        ),
        options,
      );
      return ProfileIdsSchema.parse(JSON.parse(stdout)).flatMap((id) =>
        id.endsWith(":manual") ? [id.slice(0, -":manual".length)] : [],
      );
    },
    set: async (provider, key) => {
      await mkdir(options.env.OPENCLAW_STATE_DIR, { recursive: true });
      await new Promise<void>((resolve, reject) => {
        const child = execFile(
          process.execPath,
          script(`let key = "";
for await (const chunk of process.stdin) key += chunk;
const saved = await sdk.upsertAuthProfileWithLock({
  profileId: ${JSON.stringify(`${provider}:manual`)},
  credential: { type: "api_key", provider: ${JSON.stringify(provider)}, key },
});
if (!saved) throw new Error("the key store is busy");`),
          options,
          (error) => {
            if (!error) resolve();
            // The message never holds the key: it arrives on stdin.
            else
              reject(
                new Error(
                  `Couldn't save the ${provider} key: ${error.message}`,
                ),
              );
          },
        );
        child.stdin?.end(key);
      });
    },
  };
}

const WorldSchema = z.object({
  /** Only on the live copy: which template it came from. */
  id: z.string().optional(),
  title: z.string(),
  description: z.string(),
  systemAgent: z.string(),
  /** The group picked to start with: a value of one of the world's anchors. */
  defaultGroup: z.string().optional(),
  /** Merged into the plugin's config. */
  kazusa: z.record(z.string(), z.unknown()),
});

const BaseSchema = z.object({
  systemAgent: z.record(z.string(), z.unknown()),
  config: z.looseObject({
    agents: z.looseObject({ defaults: z.record(z.string(), z.unknown()) }),
    plugins: z.looseObject({
      entries: z.looseObject({
        kazusa: z.looseObject({ config: z.record(z.string(), z.unknown()) }),
      }),
    }),
  }),
});

export const SetupRequestSchema = z.object({
  world: z.string(),
  cast: z.array(z.string()).default([]),
  /**
   * Wall clock (`YYYY-MM-DDTHH:mm`) as picked. Sim time is shown in UTC, so it
   * is kept as UTC.
   */
  startAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    .optional(),
  key: z
    .object({
      provider: z.string().min(1),
      value: z.string().trim().min(1),
    })
    .optional(),
});
export type SetupRequest = z.infer<typeof SetupRequestSchema>;

export interface CharacterGroup {
  readonly name: string;
  readonly ids: readonly string[];
}

export interface WorldOption {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly systemAgent: string;
  /** Everyone but the system agent; none means there's no cast to choose. */
  readonly characters: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  /** One list per anchor (Schools, Clubs), broadest first. */
  readonly groups: readonly {
    readonly field: string;
    readonly groups: readonly CharacterGroup[];
  }[];
  readonly defaultCast: readonly string[];
}

export interface SetupStatus {
  readonly configured: boolean;
  readonly worlds: readonly WorldOption[];
  /** The world already copied by an earlier, unfinished run. */
  readonly imported: string | null;
  /** The providers offered a key, in order; empty once configured. */
  readonly providers: readonly SetupProvider[];
  /** Whose key an earlier, unfinished run saved. */
  readonly savedKey: SetupProvider | null;
}

/** What `memory.anchors` defaults to in the plugin. */
const DEFAULT_ANCHORS = { school: "familiar", club: "intimate" };
const AnchorsSchema = z.object({
  memory: z.object({ anchors: z.record(z.string(), z.string()) }),
});

const ignoreDsStore = (source: string) => path.basename(source) !== ".DS_Store";

async function directories(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** A character's display name, from the frontmatter of their `IDENTITY.md`. */
async function characterName(workspaces: string, id: string): Promise<string> {
  const identity = await readFile(
    path.join(workspaces, id, "IDENTITY.md"),
    "utf8",
  );
  const name = /^name:\s*["']?(.+?)["']?\s*$/m.exec(identity)?.[1];
  return name ?? id;
}

const frontmatterField = (text: string, field: string): string | undefined =>
  new RegExp(`^${field}:\\s*["']?(.+?)["']?\\s*$`, "m").exec(text)?.[1];

const readIfPresent = async (file: string): Promise<string | undefined> =>
  existsSync(file) ? readFile(file, "utf8") : undefined;

/**
 * The groups a world already defines: its anchors, read off the wiki's
 * character cards. An anchor's value may name a concept page, whose title reads
 * better.
 */
async function characterGroups(
  wiki: string,
  ids: readonly string[],
  anchors: Readonly<Record<string, string>>,
) {
  const cards = await Promise.all(
    ids.map(
      async (id) =>
        [
          id,
          (await readIfPresent(
            path.join(wiki, "entities/characters", `${id}.md`),
          )) ?? "",
        ] as const,
    ),
  );
  const fields = Object.keys(anchors).sort(
    (a, b) =>
      Number(anchors[a] === "intimate") - Number(anchors[b] === "intimate"),
  );
  return Promise.all(
    fields.map(async (field) => {
      const members = new Map<string, string[]>();
      for (const [id, card] of cards) {
        const value = frontmatterField(card, field);
        if (value) members.set(value, [...(members.get(value) ?? []), id]);
      }
      const groups = await Promise.all(
        [...members]
          .filter(([, group]) => group.length > 1)
          .map(async ([value, group]) => {
            const concept = await readIfPresent(
              path.join(wiki, "concepts", `${value}.md`),
            );
            return {
              value,
              name: (concept && frontmatterField(concept, "title")) ?? value,
              ids: group,
            };
          }),
      );
      return {
        field,
        groups: groups.toSorted((a, b) => a.name.localeCompare(b.name)),
      };
    }),
  );
}

export function createSetup(
  appDir: string,
  keys: KeyStore = sdkKeyStore(appDir),
) {
  const worldsDir = path.join(appDir, "worlds");
  const liveDir = path.join(appDir, "world");
  const configFile = path.join(liveDir, "openclaw.json");
  const envFile = path.join(liveDir, ".state/.env");
  const markerFile = path.join(liveDir, "world.json");

  const readWorld = async (dir: string) =>
    WorldSchema.parse(
      JSON.parse(await readFile(path.join(dir, "world.json"), "utf8")),
    );

  const savedEnv = async (): Promise<string> =>
    existsSync(envFile) ? readFile(envFile, "utf8") : "";

  async function worldOption(id: string): Promise<WorldOption> {
    const dir = path.join(worldsDir, id);
    const world = await readWorld(dir);
    const workspaces = path.join(dir, "workspaces");
    const ids = (await directories(workspaces)).filter(
      (agent) => agent !== world.systemAgent,
    );
    const named = await Promise.all(
      ids.map(async (agent) => ({
        id: agent,
        name: await characterName(workspaces, agent),
      })),
    );
    const characters = named.toSorted((a, b) => a.name.localeCompare(b.name));
    const anchors =
      AnchorsSchema.safeParse(world.kazusa).data?.memory.anchors ??
      DEFAULT_ANCHORS;
    const fields = ids.length
      ? await characterGroups(path.join(dir, "shared/wiki"), ids, anchors)
      : [];
    const defaultCast =
      fields
        .flatMap(({ groups }) => groups)
        .find(({ value }) => value === world.defaultGroup)?.ids ?? [];
    return {
      id,
      title: world.title,
      description: world.description,
      systemAgent: world.systemAgent,
      characters,
      groups: fields.map(({ field, groups }) => ({
        field,
        groups: groups.map(({ name, ids: members }) => ({
          name,
          ids: members,
        })),
      })),
      defaultCast,
    };
  }

  async function status(): Promise<SetupStatus> {
    const ids = (await directories(worldsDir)).filter((id) =>
      existsSync(path.join(worldsDir, id, "world.json")),
    );
    const worlds = await Promise.all(ids.map(worldOption));
    const imported = existsSync(markerFile)
      ? (WorldSchema.parse(JSON.parse(await readFile(markerFile, "utf8"))).id ??
        null)
      : null;
    return {
      configured: existsSync(configFile),
      // Starting from scratch reads best as the last choice.
      worlds: worlds.toSorted(
        (a, b) => Number(a.id === "starter") - Number(b.id === "starter"),
      ),
      imported,
      // Once a world exists its Gateway owns the auth store; setup is over.
      ...(existsSync(configFile)
        ? { providers: [], savedKey: null }
        : { providers: await offered(), savedKey: await savedKey() }),
    };
  }

  /**
   * Copies only what's missing. The marker goes last, so a crash just copies
   * again.
   */
  async function importWorld(id: string): Promise<void> {
    if (existsSync(markerFile)) return;
    const dir = path.join(worldsDir, id);
    const world = await readWorld(dir);
    await mkdir(liveDir, { recursive: true });
    for (const part of ["shared", "workspaces"])
      await cp(path.join(dir, part), path.join(liveDir, part), {
        recursive: true,
        force: false,
        filter: ignoreDsStore,
      });
    // The system agent reads Kazusa's own guides through this link. Only Windows
    // reads the type: a junction needs no admin rights or Developer Mode.
    const link = path.join(liveDir, "workspaces", world.systemAgent, ".agents");
    if (!existsSync(link))
      await symlink(
        path.relative(path.dirname(link), path.join(appDir, "../../.agents")),
        link,
        "junction",
      );
    // What a later world update compares against: the template as imported.
    await writeTemplateSnapshot(liveDir, dir, id);
    await writeFile(
      markerFile,
      `${JSON.stringify({ ...world, id }, null, 2)}\n`,
    );
  }

  /** A key from before keys moved into profiles: the environment or `.env`. */
  async function keyOutsideProfile(): Promise<string | undefined> {
    return (
      process.env[OPENROUTER_KEY]?.trim() ||
      parseEnv(await savedEnv())[OPENROUTER_KEY]?.trim() ||
      undefined
    );
  }

  async function readBase() {
    return BaseSchema.parse(
      JSON.parse(await readFile(path.join(worldsDir, "base.json"), "utf8")),
    );
  }

  async function offered(): Promise<SetupProvider[]> {
    const { models } = OfferedSchema.parse(
      (await readBase()).config.plugins.entries.kazusa.config,
    );
    return models.providers.flatMap((id) => setupProvider(id) ?? []);
  }

  /** An offered provider's key in a profile, else one from the old keys file. */
  async function savedKey(): Promise<SetupProvider | null> {
    const saved = await keys.saved();
    return (
      (await offered()).find(({ id }) => saved.includes(id)) ??
      ((await keyOutsideProfile())
        ? (setupProvider("openrouter") ?? null)
        : null)
    );
  }

  /**
   * Into an auth profile. A key already there wins, as a key already in `.env`
   * did, so finishing an interrupted run never swaps it.
   */
  async function saveKey(typed: SetupRequest["key"]): Promise<void> {
    const saved = await keys.saved();
    if ((await offered()).some(({ id }) => saved.includes(id))) return;
    const key = typed ?? {
      provider: "openrouter",
      value: await keyOutsideProfile(),
    };
    if (key.value) await keys.set(key.provider, key.value);
  }

  async function writeConfig(request: SetupRequest): Promise<void> {
    const world = WorldSchema.parse(
      JSON.parse(await readFile(markerFile, "utf8")),
    );
    const base = await readBase();
    const agents = await directories(path.join(liveDir, "workspaces"));
    const name = await characterName(
      path.join(liveDir, "workspaces"),
      world.systemAgent,
    );
    const entries: Record<string, unknown> = Object.fromEntries(
      agents.map((id) => [id, { workspace: `./workspaces/${id}` }]),
    );
    // Its tools and skills come with Kazusa, so they update with it.
    const included = path.join(liveDir, SYSTEM_AGENT_INCLUDE);
    await mkdir(path.dirname(included), { recursive: true });
    await writeFile(included, `${JSON.stringify(base.systemAgent, null, 2)}\n`);
    entries[world.systemAgent] = {
      $include: SYSTEM_AGENT_INCLUDE,
      workspace: `./workspaces/${world.systemAgent}`,
      identity: { name },
      cwd: liveDir,
    };
    const kazusa = base.config.plugins.entries.kazusa.config;
    const memory = {
      ...(kazusa.memory as object),
      ...(world.kazusa.memory as object | undefined),
    };
    // A chosen cast starts paused, so nobody spends anything before the player is ready.
    const chosen =
      agents.length > 1
        ? {
            stage: {
              defaultOnstage: false,
              cast: [world.systemAgent, ...request.cast],
            },
            clock: {
              speed: 0,
              ...(request.startAt
                ? { startAt: `${request.startAt}:00.000Z` }
                : {}),
            },
          }
        : {};
    const config = {
      ...base.config,
      agents: {
        ...base.config.agents,
        defaults: {
          ...base.config.agents.defaults,
          systemAgent: { agentId: world.systemAgent },
        },
        entries,
      },
      plugins: {
        ...base.config.plugins,
        entries: {
          ...base.config.plugins.entries,
          kazusa: {
            ...base.config.plugins.entries.kazusa,
            config: { ...kazusa, ...world.kazusa, memory, ...chosen },
          },
        },
      },
    };
    const temporary = `${configFile}.tmp`;
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, configFile);
  }

  async function apply(request: SetupRequest): Promise<void> {
    if (existsSync(configFile)) return;
    if (!(await status()).worlds.some(({ id }) => id === request.world))
      throw new Error(`Unknown world: ${request.world}`);
    if (
      request.key &&
      !(await offered()).some(({ id }) => id === request.key?.provider)
    )
      throw new Error(`Unknown provider: ${request.key.provider}`);
    await importWorld(request.world);
    await saveKey(request.key);
    await writeConfig(request);
  }

  return { status, apply, files: { config: configFile, env: envFile } };
}

// Untraced: Turbopack would otherwise watch everything under the live world,
// whose state the Gateway writes all the time, and reload every open page.
export const setup = createSetup(
  path.resolve(/* turbopackIgnore: true */ process.cwd(), "../kazusa"),
);
