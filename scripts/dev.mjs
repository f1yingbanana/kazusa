#!/usr/bin/env node
/**
 * The one command: installs what's missing, then runs the frontend and, once
 * the setup guide has made a world, the Gateway. One Ctrl+C stops both.
 *
 * The Gateway keeps its token auth even on loopback, because without it any
 * website the player visits can POST to it. Nobody has to see the token: it is
 * made once, kept with the world's keys, and handed to the frontend's proxy.
 * The frontend binds to loopback because that proxy adds the token.
 */
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import {
  allowChatStarters,
  loadNewPlugins,
  startProviderPlugins,
} from "./plugin-startup.mjs";
import { dropStoreKeyRefs } from "./provider-keys.mjs";
import { adoptWorldPackage } from "./world-package.mjs";
import { syncSystemAgent } from "./system-agent.mjs";
import { applyPending, clearTrash, updatePaths } from "./update.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = path.join(ROOT, "apps/kazusa/world");
const CONFIG = path.join(WORLD, "openclaw.json");
const ENV_FILE = path.join(WORLD, ".state/.env");
const UPDATE = updatePaths(ROOT);
const GATEWAY_PORT = 18789;
const WEB_PORT = 3000;
const POLL_MS = 500;

// The installer ships a built frontend and its own Node (`scripts/package.mjs`).
const PACKAGED = process.argv.includes("--packaged");

// Run through Node, because `.bin` holds `.cmd` shims that Windows can't spawn.
const NEXT = path.join(ROOT, "node_modules/next/dist/bin/next");
const OPENCLAW = path.join(ROOT, "node_modules/openclaw/openclaw.mjs");
// New worlds load these plugins by path, so an older install has to pick up
// any added since. Every dependency but OpenClaw itself is a plugin.
const PLUGINS = Object.keys(
  JSON.parse(readFileSync(path.join(ROOT, "apps/kazusa/package.json"), "utf8"))
    .dependencies,
)
  .filter((name) => name !== "openclaw")
  .map((name) => path.join(ROOT, "node_modules", name));
const BROWSER_OPENERS = {
  darwin: ["open"],
  linux: ["xdg-open"],
  win32: ["cmd", "/c", "start", ""],
};

/** The environment with our Node first, for anything the Gateway's agents run. */
function withBundledNode(env) {
  if (!PACKAGED) return env;
  // Windows spells it `Path`, and a second `PATH` beside it would be ambiguous.
  const key =
    Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
  const nodeDir = path.dirname(process.execPath);
  return { ...env, [key]: `${nodeDir}${path.delimiter}${env[key] ?? ""}` };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function requireSupportedNode() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if ((major === 24 && minor >= 16) || (major === 26 && minor >= 1)) return;
  if (major > 26) return;
  fail(
    `Kazusa needs Node.js 24.16+ (24.x) or 26.1+. This is ${process.version}.`,
  );
}

function gatewayToken() {
  mkdirSync(path.dirname(ENV_FILE), { recursive: true });
  const saved = existsSync(ENV_FILE)
    ? parseEnv(readFileSync(ENV_FILE, "utf8")).OPENCLAW_GATEWAY_TOKEN
    : undefined;
  if (saved) return saved;
  const token = randomBytes(32).toString("hex");
  appendFileSync(ENV_FILE, `OPENCLAW_GATEWAY_TOKEN=${token}\n`, {
    mode: 0o600,
  });
  return token;
}

function isListening(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Applies the update Settings staged (`scripts/update.mjs`), then hands this
 * terminal to the version now on disk. Never settles: this process only waits
 * for the new one and exits with it.
 */
function updateAndRestart() {
  const result = applyPending(ROOT);
  if (result)
    console.log(
      result.ok
        ? `\nUpdated to ${result.version}. Starting it.\n`
        : result.applied
          ? `\nUpdated to ${result.version}, but installing its dependencies failed: ${result.error}\nTrying again. Your world is unchanged.\n`
          : `\nCouldn't update to ${result.version}: ${result.error}\nStarting the version you had. Your world is unchanged.\n`,
    );
  const next = spawn(process.execPath, process.argv.slice(1), {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, KAZUSA_RESTARTED: "1" },
  });
  // Ctrl+C reaches the new process on its own; this one keeps waiting for it.
  process.on("SIGINT", () => undefined);
  process.on("SIGTERM", () => next.kill("SIGTERM"));
  next.once("exit", (code) => process.exit(code ?? 0));
  return new Promise(() => undefined);
}

requireSupportedNode();
// Before updating or installing: either would pull files out from under a
// running copy, such as one still stopping for the update it staged.
for (const [port, name] of [
  [GATEWAY_PORT, "the Gateway"],
  [WEB_PORT, "the frontend"],
]) {
  if (await isListening(port))
    fail(
      `Port ${port} is already in use, so ${name} can't start. Stop whatever is using it and try again.`,
    );
}
// Staged before the last stop, so nothing has run it yet.
if (existsSync(UPDATE.pending)) await updateAndRestart();
clearTrash(ROOT);
// An update whose `npm ci` failed left a half-installed `node_modules`.
if (
  existsSync(UPDATE.reinstall) ||
  !existsSync(NEXT) ||
  !existsSync(path.join(ROOT, "node_modules/simple-git")) ||
  !PLUGINS.every((dir) => existsSync(dir))
) {
  console.log("Installing dependencies.");
  execFileSync("npm", ["ci", "--no-audit", "--no-fund"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  rmSync(UPDATE.reinstall, { force: true });
}

const firstRun = !existsSync(CONFIG);
const token = gatewayToken();
const children = new Map();
let stopping = false;
let updating = false;

function stop(exitCode, { fromConsole = false } = {}) {
  if (stopping) return;
  stopping = true;
  clearInterval(updateWatch);
  process.exitCode = exitCode;
  console.log(
    "\nStopping. The Gateway lets running turns finish first, which can take a few minutes.",
  );
  // Windows has no SIGTERM: kill() ends a child outright, so leave Ctrl+C to do it.
  if (fromConsole && process.platform === "win32") return;
  // A terminal's Ctrl+C reaches the children too; this covers everything else.
  // Never kill the Gateway: it can leave agent databases degraded. Closing its
  // lifeline stops it as Ctrl+C would, even on Windows, where kill() can't.
  for (const [name, child] of children) {
    if (name === "gateway") child.stdin.end();
    else child.kill("SIGTERM");
  }
}

// Settings stages an update for this process to apply once everything stops.
// It waits a poll first, so the page that asked for it hears back.
let updateSeen = false;
const updateWatch = setInterval(() => {
  if (stopping || !existsSync(UPDATE.pending)) return;
  if (!updateSeen) {
    updateSeen = true;
    return;
  }
  updating = true;
  console.log(
    "\nUpdating Kazusa. It stops first, then starts the new version.",
  );
  stop(0);
  if (children.size === 0) void updateAndRestart();
}, POLL_MS);

function start(name, command, args, options) {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  children.set(name, child);
  // Closing a lifeline the child already let go of isn't an error.
  child.stdin?.on("error", () => undefined);
  for (const stream of [child.stdout, child.stderr]) {
    let partial = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      const lines = (partial + chunk).split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) console.log(`[${name}] ${line}`);
    });
  }
  child.once("error", (error) => {
    console.error(`[${name}] couldn't start: ${error.message}`);
    children.delete(name);
    stop(1);
  });
  child.once("exit", (code) => {
    children.delete(name);
    if (updating) {
      if (children.size === 0) void updateAndRestart();
      return;
    }
    if (!stopping) {
      console.error(`[${name}] stopped unexpectedly (exit code ${code}).`);
      stop(code || 1);
    }
  });
}

process.on("SIGINT", () => {
  // Quitting mid-update: the next start applies it instead.
  updating = false;
  stop(0, { fromConsole: true });
});
process.on("SIGTERM", () => stop(0));

// Templates downloaded here (the world in play, usually) are brought up to
// date before setup or a world update reads them.
try {
  // After the install above: it needs simple-git.
  const { syncWorlds } = await import("./world-repo.mjs");
  for (const line of await syncWorlds(ROOT)) console.log(line);
} catch (error) {
  console.warn(`Couldn't update the worlds: ${error.message}`);
}

start(
  "web",
  process.execPath,
  [
    NEXT,
    PACKAGED ? "start" : "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(WEB_PORT),
  ],
  {
    cwd: path.join(ROOT, "apps/web"),
    env: {
      ...process.env,
      KAZUSA_GATEWAY_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
      OPENCLAW_GATEWAY_TOKEN: token,
      // Tells the updater someone can restart Kazusa once it's staged.
      KAZUSA_SUPERVISED: "1",
    },
  },
);

while (!stopping && !(await isListening(WEB_PORT))) await sleep(POLL_MS);
if (!stopping) {
  const url = `http://localhost:${WEB_PORT}`;
  console.log(`\nKazusa is running. Open ${url}\n`);
  // Someone who double-clicked an icon has no terminal habit to fall back on.
  // After an update, the page that asked for it reloads itself.
  const opener = BROWSER_OPENERS[process.platform];
  if (opener && !process.env.KAZUSA_RESTARTED && (firstRun || PACKAGED))
    spawn(opener[0], [...opener.slice(1), url], { stdio: "ignore" });
}

// The setup guide writes the config last, once the world is complete.
while (!stopping && !existsSync(CONFIG)) await sleep(POLL_MS);
if (!stopping) {
  try {
    for (const line of syncSystemAgent(ROOT)) console.log(line);
  } catch (error) {
    console.warn(`Couldn't update the system agent's tools: ${error.message}`);
  }
  try {
    for (const line of dropStoreKeyRefs(ROOT)) console.log(line);
  } catch (error) {
    console.warn(`Couldn't finish moving provider keys: ${error.message}`);
  }
  try {
    for (const line of adoptWorldPackage(ROOT)) console.log(line);
  } catch (error) {
    console.warn(`Couldn't give this world a package.json: ${error.message}`);
  }
  try {
    // After the install above: it needs simple-git.
    const { adoptWorldRepo } = await import("./world-repo.mjs");
    for (const line of await adoptWorldRepo(ROOT)) console.log(line);
  } catch (error) {
    console.warn(`Couldn't set up this world's history: ${error.message}`);
  }
  try {
    for (const line of loadNewPlugins(ROOT)) console.log(line);
  } catch (error) {
    console.warn(`Couldn't add new plugins to this world: ${error.message}`);
  }
  try {
    for (const line of allowChatStarters(ROOT)) console.log(line);
  } catch (error) {
    console.warn(`Couldn't let characters start chats: ${error.message}`);
  }
  try {
    for (const line of startProviderPlugins(ROOT)) console.log(line);
  } catch (error) {
    console.warn(
      `Couldn't set provider plugins to start with the Gateway: ${error.message}`,
    );
  }
  start("gateway", process.execPath, [OPENCLAW, "gateway"], {
    cwd: WORLD,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...withBundledNode(process.env),
      OPENCLAW_CONFIG_PATH: "./openclaw.json",
      OPENCLAW_STATE_DIR: "./.state",
      OPENCLAW_GATEWAY_HOST_LIFELINE: "stdin",
    },
  });
}
