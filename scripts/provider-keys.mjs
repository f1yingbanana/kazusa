#!/usr/bin/env node
/**
 * Provider keys moved from OpenClaw's secret store into auth profiles, the only
 * place model discovery reads a real key from. A store reference left in
 * `openclaw.json` would hide a profile from discovery, and dropping one reloads
 * every plugin while the Gateway runs, so this runs before it starts. The
 * plugin copies a stored key into a profile first (`providers/migrate.ts`), so
 * no key is lost: a reference goes only once its profile exists, or when the
 * store has nothing behind it. deprecated: only worlds made by 0.1.3 and 0.2.0
 * have store references; remove once none are left.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Where Kazusa's own config used to keep TypeSafe's key. */
const TYPESAFE_PATH = ["plugins", "entries", "kazusa", "config", "decisions"];

/** A reference Kazusa wrote; one pointing anywhere else is the user's. */
const isStoreRef = (value) =>
  value?.source === "store" && value?.provider === "default" && value?.id;

/** Removes `object[key]`, then each parent left empty, up `parents`. */
function drop(parents, key) {
  delete parents.at(-1)[key];
  for (let i = parents.length - 1; i > 0; i--) {
    const [parent, child] = [parents[i - 1], parents[i]];
    if (Object.keys(child).length) break;
    for (const [name, value] of Object.entries(parent))
      if (value === child) delete parent[name];
  }
}

/**
 * Drops the references and then their store entries. `deps` reach OpenClaw:
 * `profiles()` names the providers with a Kazusa auth profile, `stored()` the
 * store's entries. Returns what it changed, to report.
 */
export function dropStoreKeyRefs(root, deps = openclawDeps(root)) {
  const configFile = path.join(root, "apps/kazusa/world/openclaw.json");
  if (!existsSync(configFile)) return [];
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  const refs = [];
  for (const [id, entry] of Object.entries(config.models?.providers ?? {}))
    if (isStoreRef(entry?.apiKey))
      refs.push({
        provider: id,
        name: entry.apiKey.id,
        parents: [config, config.models, config.models.providers, entry],
        key: "apiKey",
      });
  let node = config;
  const parents = [];
  for (const key of TYPESAFE_PATH) {
    parents.push(node);
    node = node?.[key];
  }
  if (isStoreRef(node?.typesafeApiKey))
    refs.push({
      provider: "typesafe",
      name: node.typesafeApiKey.id,
      parents: [...parents, node],
      key: "typesafeApiKey",
    });
  if (!refs.length) return [];

  const profiles = deps.profiles();
  const stored = deps.stored();
  const dropped = refs.filter(
    ({ provider, name }) => profiles.has(provider) || !stored.has(name),
  );
  if (!dropped.length) return [];
  for (const { parents: chain, key } of dropped) drop(chain, key);
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  const left = new Set(
    refs.filter((ref) => !dropped.includes(ref)).map((ref) => ref.name),
  );
  const orphans = [
    ...new Set(
      dropped.map((ref) => ref.name).filter((name) => !left.has(name)),
    ),
  ].filter((name) => stored.has(name));
  if (orphans.length) deps.remove(orphans);
  const moved = dropped.filter(({ provider }) => profiles.has(provider));
  return moved.length
    ? [
        `Provider keys for ${moved.map((ref) => ref.provider).join(", ")} now live in auth profiles.`,
      ]
    : [];
}

/** Through OpenClaw itself, with the world's state, while no Gateway runs. */
/**
 * Lists Kazusa's profiles through OpenClaw's SDK at `sdk`, imported by
 * `file://` URL: Node reads a bare Windows path's drive (`Z:`) as a URL scheme
 * and refuses it.
 */
export function profilesScript(sdk, windows = process.platform === "win32") {
  return `const { ensureAuthProfileStore } = await import(${JSON.stringify(pathToFileURL(sdk, { windows }).href)});
const ids = Object.keys(ensureAuthProfileStore().profiles);
process.stdout.write(JSON.stringify(ids.filter((id) => id.endsWith(":manual")).map((id) => id.slice(0, -":manual".length))));`;
}

export function openclawDeps(root) {
  const world = path.join(root, "apps/kazusa/world");
  const env = {
    ...process.env,
    OPENCLAW_CONFIG_PATH: path.join(world, "openclaw.json"),
    OPENCLAW_STATE_DIR: path.join(world, ".state"),
  };
  const cli = path.join(root, "node_modules/openclaw/openclaw.mjs");
  const run = (args, input) =>
    execFileSync(process.execPath, args, {
      cwd: world,
      env,
      encoding: "utf8",
      input,
      stdio: ["pipe", "pipe", "ignore"],
    });
  return {
    profiles: () => {
      const sdk = path.join(
        root,
        "node_modules/openclaw/dist/plugin-sdk/provider-auth.js",
      );
      // Kazusa names each profile `<provider>:manual` (`providers/keys.ts`).
      return new Set(
        JSON.parse(
          run(["--input-type=module", "-e", profilesScript(sdk)]) || "[]",
        ),
      );
    },
    stored: () =>
      new Set(
        JSON.parse(run([cli, "secrets", "store", "list", "--json"])).map(
          (entry) => entry.name,
        ),
      ),
    remove: (names) => run([cli, "secrets", "store", "rm", "--yes", ...names]),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const line of dropStoreKeyRefs(root)) console.log(line);
}
