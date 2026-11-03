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
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { syncSystemAgent } from "./system-agent.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = path.join(ROOT, "apps/kazusa/world");
const CONFIG = path.join(WORLD, "openclaw.json");
const ENV_FILE = path.join(WORLD, ".state/.env");
const GATEWAY_PORT = 18789;
const WEB_PORT = 3000;
const POLL_MS = 500;

// The installer ships a built frontend and its own Node (`scripts/package.mjs`).
const PACKAGED = process.argv.includes("--packaged");

// Run through Node, because `.bin` holds `.cmd` shims that Windows can't spawn.
const NEXT = path.join(ROOT, "node_modules/next/dist/bin/next");
const OPENCLAW = path.join(ROOT, "node_modules/openclaw/openclaw.mjs");
// New worlds load these plugins by path, so an older install has to pick up
// any added since.
const PLUGINS = Object.keys(
  JSON.parse(readFileSync(path.join(ROOT, "apps/kazusa/package.json"), "utf8"))
    .dependencies,
)
  .filter((name) => name.startsWith("@openclaw/"))
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

requireSupportedNode();
// Before installing: `npm ci` would pull modules out from under a running copy.
for (const [port, name] of [
  [GATEWAY_PORT, "the Gateway"],
  [WEB_PORT, "the frontend"],
]) {
  if (await isListening(port))
    fail(
      `Port ${port} is already in use, so ${name} can't start. Stop whatever is using it and try again.`,
    );
}
if (!existsSync(NEXT) || !PLUGINS.every((dir) => existsSync(dir))) {
  console.log("Installing dependencies.");
  execFileSync("npm", ["ci", "--no-audit", "--no-fund"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

const firstRun = !existsSync(CONFIG);
const token = gatewayToken();
const children = new Map();
let stopping = false;

function stop(exitCode, { fromConsole = false } = {}) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  console.log(
    "\nStopping. The Gateway lets running turns finish first, which can take a few minutes.",
  );
  // Windows has no SIGTERM: kill() ends a child outright, so leave Ctrl+C to do it.
  if (fromConsole && process.platform === "win32") return;
  // A terminal's Ctrl+C reaches the children too; this covers everything else.
  // Never SIGKILL the Gateway: it can leave agent databases degraded.
  for (const child of children.values()) child.kill("SIGTERM");
}

function start(name, command, args, options) {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  children.set(name, child);
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
    if (!stopping) {
      console.error(`[${name}] stopped unexpectedly (exit code ${code}).`);
      stop(code || 1);
    }
  });
}

process.on("SIGINT", () => stop(0, { fromConsole: true }));
process.on("SIGTERM", () => stop(0));

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
    },
  },
);

while (!stopping && !(await isListening(WEB_PORT))) await sleep(POLL_MS);
if (!stopping) {
  const url = `http://localhost:${WEB_PORT}`;
  console.log(`\nKazusa is running. Open ${url}\n`);
  // Someone who double-clicked an icon has no terminal habit to fall back on.
  const opener = BROWSER_OPENERS[process.platform];
  if (opener && (firstRun || PACKAGED))
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
  start("gateway", process.execPath, [OPENCLAW, "gateway"], {
    cwd: WORLD,
    env: {
      ...withBundledNode(process.env),
      OPENCLAW_CONFIG_PATH: "./openclaw.json",
      OPENCLAW_STATE_DIR: "./.state",
    },
  });
}
