#!/usr/bin/env node
/**
 * The one command: installs what's missing, then runs the frontend and, once
 * the setup guide has made a world, the Gateway. One Ctrl+C stops both.
 *
 * The Gateway keeps its token auth even on loopback, because without it any
 * website the player visits can POST to it. Nobody has to see the token: it is
 * made once, kept with the world's keys, and handed to the frontend's proxy.
 * The frontend binds to loopback because that proxy adds the token.
 *
 * `--public` (`npm run public`) serves a built frontend for a tunnel, such as
 * Cloudflare's, to put on the internet. Everyone there can watch; whoever signs
 * in with the Gateway token is the owner, who can also set up and update this
 * Kazusa from there. The Gateway itself stays on loopback and only ever hears
 * from the frontend.
 *
 * Saves and loads are this process's too, because both need the Gateway stopped
 * (the kazusa skill's `references/worlds.md` §4.6): the frontend stages a
 * request, and this stops the Gateway, saves or loads, and starts it again,
 * leaving the frontend running. Every clean stop autosaves.
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
  allowNewBundledPlugins,
  allowNewCharacterTools,
  denyImpliedTools,
  loadNewPlugins,
  skipUnusedStartupWork,
  startProviderPlugins,
} from "./plugin-startup.mjs";
import {
  isClone,
  worldGit,
} from "../apps/kazusa/plugins/kazusa/src/world/repo.ts";
import {
  AUTOSAVE,
  autosaveStart,
  isRunning,
  loadGame,
  newSaveRef,
  readRequest,
  saveGame,
  writeRequest,
} from "../apps/kazusa/plugins/kazusa/src/world/saves.ts";
import { syncSystemAgent, syncSystemAgentSkills } from "./system-agent.mjs";
import {
  applyPending,
  clearTrash,
  kazusaVersion,
  updatePaths,
} from "./update.mjs";

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
const PUBLIC = process.argv.includes("--public");

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

function gatewayToken(token = randomBytes(32).toString("hex")) {
  mkdirSync(path.dirname(ENV_FILE), { recursive: true });
  const saved = existsSync(ENV_FILE)
    ? parseEnv(readFileSync(ENV_FILE, "utf8")).OPENCLAW_GATEWAY_TOKEN
    : undefined;
  if (saved) return saved;
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
  // Once the Gateway has started: a request older than that is settled first.
  const request = gatewayStarted && !stopping && !saving && readRequest(WORLD);
  if (request?.phase === "waiting") void carryOut(request);
  if (stopping || saving || !existsSync(UPDATE.pending)) return;
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

// ------------------------------------------------------------ saves

let saving = false;
let gatewayStarted = false;
/** Set while a save or load has the Gateway stopped: its exit isn't the end. */
let gatewayStopped;

/** The Gateway's own routes, as the frontend's proxy calls them. */
async function gatewayRoute(route, init = {}) {
  const response = await fetch(
    `http://127.0.0.1:${GATEWAY_PORT}/kazusa/${route}`,
    {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

const setSpeed = (speed) =>
  gatewayRoute("clock", {
    method: "POST",
    body: JSON.stringify({ action: "set_speed", speed }),
  });

/** Stops only the Gateway, as a full stop would, and resolves its exit code. */
function stopGateway() {
  const gateway = children.get("gateway");
  if (!gateway) return Promise.resolve(0);
  return new Promise((resolve) => {
    gatewayStopped = (code) => {
      gatewayStopped = undefined;
      resolve(code);
    };
    gateway.stdin.end();
  });
}

/** The one autosave, as the Gateway's clean stop left the world. */
function autosave() {
  const git = isClone(WORLD) ? worldGit(WORLD) : undefined;
  if (!git) return;
  try {
    saveGame(git, WORLD, AUTOSAVE, {
      kind: "autosave",
      name: "Last stop",
      kazusaVersion: kazusaVersion(ROOT),
    });
    console.log("Autosaved the world.");
  } catch (error) {
    console.warn(`Couldn't autosave the world: ${error.message}`);
  }
}

/**
 * The save or load itself, on a stopped Gateway: the save made, or what a load
 * couldn't keep of this machine.
 */
function saveOrLoad(request) {
  const git = worldGit(WORLD);
  if (!git)
    throw new Error(
      "Git isn't available, so the world can't be saved or loaded.",
    );
  if (request.op === "load")
    return { warnings: loadGame(git, WORLD, request.ref) };
  const ref = request.ref ?? newSaveRef(git);
  saveGame(git, WORLD, ref, {
    kind: request.kind ?? "save",
    name: request.name,
    kazusaVersion: kazusaVersion(ROOT),
  });
  return { ref };
}

/**
 * Carries out the frontend's save or load: pauses the world (a save), stops the
 * Gateway, which lets running turns finish, saves or loads, and starts it
 * again, paused after a load. Each phase is written back for the frontend.
 */
async function carryOut(request) {
  saving = true;
  const set = (phase, extra = {}) => {
    request = { ...request, ...extra, phase };
    writeRequest(WORLD, request);
  };
  let error;
  let stopped = false;
  try {
    if (request.op === "save") {
      set("pausing");
      let speed;
      try {
        const { clock } = await gatewayRoute("world");
        speed = clock?.speed ?? 0;
        await setSpeed(0);
      } catch {
        throw new Error(
          "The world isn't running yet, so it can't be saved. Try again once it has started.",
        );
      }
      set("pausing", { speed });
    }
    set("stopping");
    console.log(
      `\n${request.op === "save" ? "Saving" : "Loading"} the world. The Gateway stops first, letting running turns finish.`,
    );
    const code = await stopGateway();
    stopped = true;
    if (code !== 0)
      throw new Error(
        `The Gateway didn't stop cleanly (exit code ${code}), so nothing was ${request.op === "save" ? "saved" : "loaded"}.`,
      );
    set(request.op === "save" ? "saving" : "loading");
    const { ref, warnings } = saveOrLoad(request);
    if (ref) set("saving", { ref });
    if (warnings?.length) {
      for (const warning of warnings) console.warn(warning);
      set("loading", { warnings });
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    console.warn(`Couldn't ${request.op} the world: ${error}`);
    // Half one game and half the other: never run it. The next start redoes it.
    if (request.phase === "loading") {
      console.error("Start Kazusa again to finish loading the save.");
      saving = false;
      return stop(1);
    }
  }
  if (stopped && !stopping) {
    set("starting");
    startGateway({ paused: request.op === "load" });
    // Up once Kazusa's own routes answer, not just the port: the page that
    // asked reloads or refetches then. A few minutes at most.
    const resume =
      !error && request.op === "save" && request.speed
        ? () => setSpeed(request.speed)
        : () => gatewayRoute("world");
    let up = false;
    for (let tries = 0; tries < 600 && !stopping && !up; tries++)
      // The world runs on as it did before the save.
      up = await resume().then(
        () => true,
        () => sleep(POLL_MS).then(() => false),
      );
    if (!up && !stopping) error ??= "The world didn't come back up.";
  }
  if (stopping && stopped && !error) set("starting");
  else set(error ? "failed" : "done", error ? { error } : {});
  if (!error)
    console.log(
      request.op === "save" ? "Saved the world." : "Loaded the save.",
    );
  saving = false;
}

/**
 * A save or load that Kazusa stopped in the middle of: a load cut short is done
 * again, since the world may be half one game and half the other.
 */
function finishCutShort() {
  const request = readRequest(WORLD);
  if (!isRunning(request)) return false;
  const loading = request.op === "load";
  try {
    if (request.phase === "saving" || request.phase === "loading") {
      saveOrLoad(request);
    } else if (request.phase !== "starting") {
      writeRequest(WORLD, {
        ...request,
        phase: "failed",
        error: `Kazusa stopped before it could ${request.op} the world.`,
      });
      return false;
    }
    writeRequest(WORLD, { ...request, phase: "done" });
  } catch (error) {
    writeRequest(WORLD, { ...request, phase: "failed", error: error.message });
  }
  return loading;
}

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
    // The frontend holds no state, but a browser's open connection keeps its
    // graceful shutdown waiting. Once the Gateway has stopped, force the rest.
    if (stopping && name === "gateway") {
      const force = setTimeout(() => {
        for (const other of children.values()) other.kill("SIGKILL");
      }, 5000);
      force.unref();
    }
    if (name === "gateway" && gatewayStopped) {
      gatewayStopped(code);
      return;
    }
    if (name === "gateway" && stopping && code === 0) autosave();
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

// Never the dev server on the internet: it serves source and dev endpoints.
if (PUBLIC && !PACKAGED)
  execFileSync(process.execPath, [NEXT, "build"], {
    cwd: path.join(ROOT, "apps/web"),
    stdio: "inherit",
  });

start(
  "web",
  process.execPath,
  [
    NEXT,
    PACKAGED || PUBLIC ? "start" : "dev",
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
      ...(PUBLIC
        ? { KAZUSA_AUTH_MODE: "public", KAZUSA_OWNER_SIGN_IN: "1" }
        : {}),
    },
  },
);

while (!stopping && !(await isListening(WEB_PORT))) await sleep(POLL_MS);
if (!stopping) {
  const url = `http://localhost:${WEB_PORT}`;
  console.log(`\nKazusa is running. Open ${url}\n`);
  if (PUBLIC)
    console.log(
      `For your phone, tunnel it: cloudflared tunnel --url ${url}\nSign in there with OPENCLAW_GATEWAY_TOKEN from ${path.relative(ROOT, ENV_FILE)}: setup asks for it first, then Settings > Connection.\n`,
    );
  // Someone who double-clicked an icon has no terminal habit to fall back on.
  // After an update, the page that asked for it reloads itself.
  const opener = BROWSER_OPENERS[process.platform];
  if (
    opener &&
    !process.env.KAZUSA_RESTARTED &&
    (firstRun || PACKAGED) &&
    !PUBLIC
  )
    spawn(opener[0], [...opener.slice(1), url], { stdio: "ignore" });
}

// The setup guide writes the config last, once the world is complete. A world
// an older Kazusa made (not a clone of its creator's repository) doesn't run:
// the frontend offers to set it aside and start a new one.
if (existsSync(CONFIG) && !isClone(WORLD))
  console.log(
    `\nThis world was made by an older Kazusa, which this version can't run. Open http://localhost:${WEB_PORT} to start a new world.\n`,
  );
while (!stopping && !(existsSync(CONFIG) && isClone(WORLD)))
  await sleep(POLL_MS);
/**
 * Brings this world's config up to this Kazusa and starts the Gateway: at
 * start, and again after a save or load (a save's config is from then).
 */
function startGateway({ paused = false } = {}) {
  gatewayStarted = true;
  try {
    syncSystemAgent(ROOT);
  } catch (error) {
    console.warn(`Couldn't update the system agent's tools: ${error.message}`);
  }
  try {
    syncSystemAgentSkills(ROOT);
  } catch (error) {
    console.warn(`Couldn't update the system agent's skills: ${error.message}`);
  }
  try {
    for (const line of loadNewPlugins(ROOT)) console.log(line);
    for (const line of allowNewBundledPlugins(ROOT)) console.log(line);
  } catch (error) {
    console.warn(`Couldn't add new plugins to this world: ${error.message}`);
  }
  try {
    for (const line of denyImpliedTools(ROOT)) console.log(line);
    for (const line of allowNewCharacterTools(ROOT)) console.log(line);
  } catch (error) {
    console.warn(`Couldn't settle characters' tool policy: ${error.message}`);
  }
  try {
    for (const line of startProviderPlugins(ROOT)) console.log(line);
  } catch (error) {
    console.warn(
      `Couldn't set provider plugins to start with the Gateway: ${error.message}`,
    );
  }
  try {
    for (const line of skipUnusedStartupWork(ROOT)) console.log(line);
  } catch (error) {
    console.warn(`Couldn't turn off unused start-up work: ${error.message}`);
  }
  start("gateway", process.execPath, [OPENCLAW, "gateway"], {
    cwd: WORLD,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...withBundledNode(process.env),
      // The frontend decides who is the owner and says so to the Gateway, which
      // a public Gateway would overrule by making everyone a visitor.
      ...(PUBLIC ? { KAZUSA_AUTH_MODE: "local" } : {}),
      OPENCLAW_CONFIG_PATH: "./openclaw.json",
      OPENCLAW_STATE_DIR: "./.state",
      OPENCLAW_GATEWAY_HOST_LIFELINE: "stdin",
      ...(paused ? { KAZUSA_START_PAUSED: "1" } : {}),
    },
  });
}

if (!stopping) {
  // Starting over sets the old world's `.state/` aside, the token with it; the
  // frontend already has this one.
  gatewayToken(token);
  const paused = finishCutShort();
  // A world that never ran: its beginning fills the autosave slot.
  try {
    const git = worldGit(WORLD);
    if (git && autosaveStart(git, WORLD, kazusaVersion(ROOT)))
      console.log("Autosaved the world's start.");
  } catch (error) {
    console.warn(`Couldn't autosave the world's start: ${error.message}`);
  }
  startGateway({ paused });
}
