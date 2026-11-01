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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = path.join(ROOT, "apps/kazusa/world");
const CONFIG = path.join(WORLD, "openclaw.json");
const ENV_FILE = path.join(WORLD, ".state/.env");
const GATEWAY_PORT = 18789;
const WEB_PORT = 3000;
const POLL_MS = 500;

const bin = (name) => path.join(ROOT, "node_modules/.bin", name);

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
if (!existsSync(bin("next"))) {
  console.log("Installing dependencies. This only happens once.");
  execFileSync("npm", ["ci", "--no-audit", "--no-fund"], {
    cwd: ROOT,
    stdio: "inherit",
  });
}
for (const [port, name] of [
  [GATEWAY_PORT, "the Gateway"],
  [WEB_PORT, "the frontend"],
]) {
  if (await isListening(port))
    fail(
      `Port ${port} is already in use, so ${name} can't start. Stop whatever is using it and try again.`,
    );
}

const firstRun = !existsSync(CONFIG);
const token = gatewayToken();
const children = new Map();
let stopping = false;

function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  console.log(
    "\nStopping. The Gateway lets running turns finish first, which can take a few minutes.",
  );
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

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

start(
  "web",
  bin("next"),
  ["dev", "--hostname", "127.0.0.1", "--port", String(WEB_PORT)],
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
  if (firstRun && process.platform === "darwin") spawn("open", [url]);
  if (firstRun && process.platform === "linux") spawn("xdg-open", [url]);
}

// The setup guide writes the config last, once the world is complete.
while (!stopping && !existsSync(CONFIG)) await sleep(POLL_MS);
if (!stopping) {
  start("gateway", bin("openclaw"), ["gateway"], {
    cwd: WORLD,
    env: {
      ...process.env,
      OPENCLAW_CONFIG_PATH: "./openclaw.json",
      OPENCLAW_STATE_DIR: "./.state",
    },
  });
}
