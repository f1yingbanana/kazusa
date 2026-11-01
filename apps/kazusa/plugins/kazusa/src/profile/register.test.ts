import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { ProfileResponseSchema } from "@kazusa/client";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { describe, expect, it } from "vitest";
import { registerProfile } from "./register.ts";

type Handler = (req: unknown, res: unknown) => Promise<boolean>;

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "kazusa-profile-"));
  const wikiDir = path.join(root, "shared", "wiki");
  const characters = path.join(wikiDir, "entities", "characters");
  await mkdir(characters, { recursive: true });
  const file = path.join(characters, "player.md");
  await writeFile(
    file,
    "---\ncharacter_id: user:player\nhome: hall\nname: Player\n---\n\n# Player\n\nNew here.\n",
  );
  const routes: Record<string, Handler> = {};
  registerProfile({
    pluginConfig: {
      user: { id: "user:player", name: "Player" },
      location: { wikiDir },
    },
    registerHttpRoute: (route: { path: string; handler: Handler }) => {
      routes[route.path] = route.handler;
    },
  } as unknown as OpenClawPluginApi);

  const call = async (route: string, body?: unknown) => {
    const req = Readable.from(
      body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
    ) as unknown as IncomingMessage;
    Object.assign(req, {
      method: body === undefined ? "GET" : "POST",
      headers: {},
      url: route,
      socket: new Socket(),
    });
    const res = new ServerResponse(req);
    let text = "";
    res.write = ((chunk: string) => ((text += chunk), true)) as never;
    res.end = ((chunk?: string) => {
      if (chunk) text += chunk;
      return res;
    }) as never;
    await routes[route](req, res);
    return { status: res.statusCode, body: JSON.parse(text) as unknown };
  };
  return { call, file };
}

describe("registerProfile", () => {
  it("reports the profile", async () => {
    const { call } = await setup();
    const { body } = await call("/kazusa/profile");
    expect(ProfileResponseSchema.parse(body)).toEqual({
      id: "user:player",
      name: "Player",
      about: "New here.",
      wikiPage: path.join("wiki", "entities", "characters", "player.md"),
    });
  });

  it("saves the description to the wiki and nothing else", async () => {
    const { call, file } = await setup();
    const { status, body } = await call("/kazusa/profile/save", {
      id: "user:other",
      name: "Other",
      about: "Night shift.",
    });
    expect(status).toBe(200);
    expect(ProfileResponseSchema.parse(body)).toMatchObject({
      id: "user:player",
      name: "Player",
      about: "Night shift.",
    });
    expect(await readFile(file, "utf8")).toBe(
      "---\ncharacter_id: user:player\nhome: hall\nname: Player\n---\n\n# Player\n\nNight shift.\n",
    );
  });
});
