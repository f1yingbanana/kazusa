import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  PROVIDERS,
  WorldPackageSchema,
  type ProviderEntry,
} from "@kazusa/client";
import { z } from "zod";
import { isClone } from "../../../kazusa/plugins/kazusa/src/world/repo.ts";
import {
  runScript,
  tracking,
  type ScriptProgress,
  type WorldDownload,
} from "../run-script";

/**
 * Where a world's config includes its system agent's tools from;
 * `scripts/system-agent.mjs` rewrites that file before every Gateway start.
 */
export const SYSTEM_AGENT_INCLUDE = "./.state/kazusa/system-agent.json";

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
  /** Cloned into `world/`; until then only its `package.json` is known. */
  readonly downloaded: boolean;
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

/** A world on offer: `scripts/world.mjs list` gives one per source. */
export type ListedWorld =
  | {
      readonly id: string;
      readonly downloaded: boolean;
      readonly package: unknown;
    }
  | { readonly id: string; readonly error: string };

/**
 * Which worlds there are and how to get one. `scripts/world.mjs` peeks at each
 * source's `package.json` and clones only the one picked, at its newest
 * release, straight into `world/` (`clone`), replacing another pick that wasn't
 * set up.
 */
export interface Catalog {
  readonly list: () => Promise<readonly ListedWorld[]>;
  readonly download: (
    id: string,
    onProgress?: (progress: ScriptProgress) => void,
  ) => Promise<void>;
}

const ListedSchema = z.object({
  worlds: z.array(
    z.union([
      z.object({
        id: z.string(),
        downloaded: z.boolean(),
        package: z.unknown(),
      }),
      z.object({ id: z.string(), error: z.string() }),
    ]),
  ),
});

/** Peeks take about a second each, all at once; a clone, as long as it takes. */
export const scriptCatalog: Catalog = {
  list: async () => {
    const result = await runScript("world.mjs", ["list"], 60_000);
    if (!result.ok) throw new Error(result.error);
    return ListedSchema.parse(result.value).worlds;
  },
  download: async (id, onProgress) => {
    const result = await runScript("world.mjs", ["clone", id], 0, onProgress);
    if (!result.ok) throw new Error(result.error);
  },
};

export interface SetupStatus {
  readonly configured: boolean;
  readonly worlds: readonly WorldOption[];
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

/**
 * First-run setup. The player's world is a git clone of its creator's
 * repository in `world/`, so playing never touches Kazusa's own files. Every
 * step can run again, and `openclaw.json` is written last: its existence means
 * setup is done and is what starts the Gateway (`scripts/dev.mjs`).
 */
export function createSetup(
  appDir: string,
  keys: KeyStore = sdkKeyStore(appDir),
  catalog: Catalog = scriptCatalog,
) {
  const liveDir = path.join(appDir, "world");
  const configFile = path.join(liveDir, "openclaw.json");
  const envFile = path.join(liveDir, ".state/.env");

  const readWorld = async (dir: string) =>
    WorldPackageSchema.parse(
      JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")),
    );

  /** The picked world, cloned into `world/` by `prepare`. */
  async function worldOption(id: string): Promise<WorldOption> {
    const dir = liveDir;
    const world = await readWorld(dir);
    const workspaces = path.join(dir, "workspaces");
    const ids = (await directories(workspaces)).filter(
      (agent) => agent !== world.kazusa.systemAgent,
    );
    const named = await Promise.all(
      ids.map(async (agent) => ({
        id: agent,
        name: await characterName(workspaces, agent),
      })),
    );
    const characters = named.toSorted((a, b) => a.name.localeCompare(b.name));
    const anchors =
      AnchorsSchema.safeParse(world.kazusa.config).data?.memory.anchors ??
      DEFAULT_ANCHORS;
    const fields = ids.length
      ? await characterGroups(path.join(dir, "shared/wiki"), ids, anchors)
      : [];
    const defaultCast =
      fields
        .flatMap(({ groups }) => groups)
        .find(({ value }) => value === world.kazusa.defaultGroup)?.ids ?? [];
    return {
      id,
      downloaded: true,
      title: world.kazusa.title ?? world.displayName ?? world.name,
      description: world.description ?? "",
      systemAgent: world.kazusa.systemAgent,
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

  /** Downloaded: the whole option. Not yet: what its `package.json` says. */
  async function listedOption(
    listed: ListedWorld,
  ): Promise<WorldOption | undefined> {
    if ("error" in listed) {
      console.warn(`Couldn't list the ${listed.id} world: ${listed.error}`);
      return undefined;
    }
    if (listed.downloaded) return worldOption(listed.id);
    const world = WorldPackageSchema.safeParse(listed.package).data;
    if (!world) return undefined;
    return {
      id: listed.id,
      downloaded: false,
      title: world.kazusa.title ?? world.displayName ?? world.name,
      description: world.description ?? "",
      systemAgent: world.kazusa.systemAgent,
      characters: [],
      groups: [],
      defaultCast: [],
    };
  }

  // A second request for a world downloading waits for the same download.
  const cloning = new Map<string, Promise<void>>();
  let progress: WorldDownload | undefined;

  /**
   * Downloads the world the player picked straight into `world/`, for its cast:
   * a clone of its newest release, git's progress kept for the guide.
   */
  async function prepare(id: string): Promise<WorldOption> {
    const pending =
      cloning.get(id) ??
      catalog
        .download(
          id,
          tracking((download) => {
            progress = download;
          }),
        )
        .finally(() => {
          progress = undefined;
        });
    cloning.set(id, pending);
    try {
      await pending;
    } finally {
      cloning.delete(id);
    }
    return worldOption(id);
  }

  async function status(): Promise<SetupStatus> {
    const worlds = (
      await Promise.all((await catalog.list()).map(listedOption))
    ).filter((option) => option !== undefined);
    return {
      configured: existsSync(configFile),
      // Starting from scratch reads best as the last choice.
      worlds: worlds.toSorted(
        (a, b) => Number(a.id === "starter") - Number(b.id === "starter"),
      ),
      // Once a world exists its Gateway owns the auth store; setup is over.
      ...(existsSync(configFile)
        ? { providers: [], savedKey: null }
        : { providers: await offered(), savedKey: await savedKey() }),
    };
  }

  /**
   * The cloned world made this machine's: the system agent's link to Kazusa's
   * own guides. Everything else is the clone's.
   */
  async function importWorld(): Promise<void> {
    const world = await readWorld(liveDir);
    // Only Windows reads the type: a junction needs no admin rights or
    // Developer Mode.
    const link = path.join(
      liveDir,
      "workspaces",
      world.kazusa.systemAgent,
      ".agents",
    );
    if (!existsSync(link))
      await symlink(
        path.relative(path.dirname(link), path.join(appDir, "../../.agents")),
        link,
        "junction",
      );
  }

  async function readBase() {
    return BaseSchema.parse(
      JSON.parse(await readFile(path.join(appDir, "base.json"), "utf8")),
    );
  }

  async function offered(): Promise<SetupProvider[]> {
    const { models } = OfferedSchema.parse(
      (await readBase()).config.plugins.entries.kazusa.config,
    );
    return models.providers.flatMap((id) => setupProvider(id) ?? []);
  }

  /** The offered provider whose key an earlier, unfinished run saved. */
  async function savedKey(): Promise<SetupProvider | null> {
    const saved = await keys.saved();
    return (await offered()).find(({ id }) => saved.includes(id)) ?? null;
  }

  /**
   * Into an auth profile. A key already there wins, so finishing an interrupted
   * run never swaps it.
   */
  async function saveKey(typed: SetupRequest["key"]): Promise<void> {
    if (!typed) return;
    const saved = await keys.saved();
    if ((await offered()).some(({ id }) => saved.includes(id))) return;
    await keys.set(typed.provider, typed.value);
  }

  async function writeConfig(request: SetupRequest): Promise<void> {
    const { kazusa: world } = await readWorld(liveDir);
    const base = await readBase();
    const agents = await directories(path.join(liveDir, "workspaces"));
    const name = await characterName(
      path.join(liveDir, "workspaces"),
      world.systemAgent,
    );
    const entries: Record<string, unknown> = Object.fromEntries(
      agents.map((id) => [id, { workspace: `./workspaces/${id}` }]),
    );
    // Its tools come with Kazusa, so they update with it.
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
      ...(world.config.memory as object | undefined),
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
            config: { ...kazusa, ...world.config, memory, ...chosen },
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
    if (!(await catalog.list()).some(({ id }) => id === request.world))
      throw new Error(`Unknown world: ${request.world}`);
    if (
      request.key &&
      !(await offered()).some(({ id }) => id === request.key?.provider)
    )
      throw new Error(`Unknown provider: ${request.key.provider}`);
    await prepare(request.world);
    await importWorld();
    await saveKey(request.key);
    await writeConfig(request);
  }

  /** How far the picked world's download has got, while one runs. */
  function downloads(): { readonly progress: WorldDownload | null } {
    return { progress: progress ?? null };
  }

  /**
   * A world an older Kazusa made: set up, but not a clone of its creator's
   * repository. `scripts/dev.mjs` won't start it.
   */
  const outdated = (): boolean => existsSync(configFile) && !isClone(liveDir);

  /**
   * Sets an older Kazusa's world aside in `old-worlds/`, never deleting it, so
   * setup starts a new one. The template copies that Kazusa kept go.
   */
  async function startOver(): Promise<void> {
    if (!outdated()) throw new Error("This world doesn't need replacing.");
    const aside = path.join(appDir, "old-worlds");
    await mkdir(aside, { recursive: true });
    // Local time, as the player would name it: `world-2026-11-14-16-18`.
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      now.getMonth() + 1,
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
    ]
      .map((part) => String(part).padStart(2, "0"))
      .join("-");
    await rename(liveDir, path.join(aside, `world-${stamp}`));
    for (const cache of ["worlds", ".worlds-before-repositories"])
      await rm(path.join(appDir, cache), { recursive: true, force: true });
  }

  return {
    /** Cheap: no catalog, subprocess or network, unlike `status()`. */
    configured: () => existsSync(configFile),
    outdated,
    startOver,
    status,
    prepare,
    apply,
    downloads,
    files: { config: configFile, env: envFile },
  };
}

// Untraced: Turbopack would otherwise watch everything under the live world,
// whose state the Gateway writes all the time, and reload every open page.
export const setup = createSetup(
  path.resolve(/* turbopackIgnore: true */ process.cwd(), "../kazusa"),
);
