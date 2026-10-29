import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { readSessionTranscriptCatalogPage } from "openclaw/plugin-sdk/session-transcript-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDecisionContextAssembler,
  readPersonalWiki,
} from "./decision-sources.ts";

vi.mock("openclaw/plugin-sdk/session-transcript-runtime", () => ({
  readSessionTranscriptCatalogPage: vi.fn(),
}));
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
  vi.clearAllMocks();
});
async function fixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kazusa-decision-"));
  directories.push(dir);
  return dir;
}
async function put(root: string, name: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
  await fs.writeFile(path.join(root, name), text);
}

describe("Decision context sources", () => {
  it("uses the SDK workspace and follows empty catalog pages for incoming and pending channels", async () => {
    const workspace = await fixture();
    await put(workspace, "IDENTITY.md", "Alice the student");
    await put(workspace, "SOUL.md", "Protect my friends");
    await put(workspace, "MEMORY.md", "Promised to help Bob");
    const resolveWorkspace = vi.fn(() => workspace);
    const now = Date.parse("2026-10-24T12:00:00Z");
    vi.mocked(readSessionTranscriptCatalogPage).mockImplementation(
      async ({ cursor }) =>
        cursor
          ? {
              items: [
                {
                  type: "agentMessage",
                  text: "Earlier conversation",
                  timestamp: new Date(now).toISOString(),
                },
              ],
            }
          : { items: [], nextCursor: "next" },
    );
    const api = {
      id: "kazusa",
      rootDir: "/wrong/plugin/root",
      config: {},
      pluginConfig: {},
      runtime: {
        agent: {
          resolveAgentWorkspaceDir: resolveWorkspace,
          session: { resolveStorePath: () => "/store" },
        },
      },
    } as unknown as OpenClawPluginApi;
    Object.assign(api, {
      runtime: { ...api.runtime, config: { current: () => api.config } },
    });
    const assembler = createDecisionContextAssembler(api, {
      clock: { time: () => now },
    });
    const incoming = {
      id: "1",
      sender: "bob",
      sessionKey: "agent:alice:chat:direct:bob",
      timestamp: now,
      text: "Hello",
    };
    const result = await assembler("alice", {
      brainStatus: "busy_thinking",
      incomingBundle: [incoming],
      pendingQueue: [
        { ...incoming, id: "2", sessionKey: "agent:alice:chat:group:club" },
      ],
    });
    expect(resolveWorkspace).toHaveBeenCalledWith(api.config, "alice");
    expect(result).toMatchObject({
      state: {
        character: {
          identity: "Alice the student",
          soul: "Protect my friends",
          memory: "Promised to help Bob",
        },
      },
      questions: {
        attention_allocation: expect.objectContaining({ type: "choice" }),
      },
    });
    expect(readSessionTranscriptCatalogPage).toHaveBeenCalledTimes(6);
    expect(JSON.stringify(result)).toContain("chat:group:club");
  });

  it("prioritizes sender impressions, matches non-person concepts, and excludes unrelated and symlinked evidence", async () => {
    const workspace = await fixture();
    const outside = await fixture();
    await put(
      workspace,
      "wiki/entities/characters/bob.md",
      "## Quick Impression\nMy closest friend.\n\n## Interaction Log\nLong irrelevant log",
    );
    await put(
      workspace,
      "wiki/concepts/halo.md",
      "---\ntitle: Halos\naliases: [Angel Rings]\n---\nI believe halos vanish during sleep.",
    );
    await put(
      workspace,
      "wiki/concepts/unknown.md",
      "Unrelated private thought",
    );
    await put(outside, "secret.md", "SECRET world knowledge");
    await fs.symlink(outside, path.join(workspace, "wiki", "outside"));
    await fs.symlink(
      path.join(outside, "secret.md"),
      path.join(workspace, "wiki", "secret.md"),
    );
    const found = await readPersonalWiki(
      workspace,
      ["bob"],
      "Angel Rings and secret",
      4,
    );
    expect(found).toHaveLength(2);
    expect(found[0]).toContain("closest friend");
    expect(found.join("\n")).toContain("halos vanish");
    expect(found.join("\n")).not.toContain("Long irrelevant log");
    expect(found.join("\n")).not.toContain("SECRET");
    expect(await readPersonalWiki(workspace, ["bob"], "Halos", 1)).toHaveLength(
      1,
    );
  });

  it("supports missing wiki and aborts cancelled reads", async () => {
    const workspace = await fixture();
    expect(await readPersonalWiki(workspace, [], "Hello", 4)).toEqual([]);
    await put(workspace, "wiki/bob.md", "Bob");
    await expect(
      readPersonalWiki(workspace, ["bob"], "Bob", 4, AbortSignal.abort()),
    ).rejects.toThrow();
  });

  it("matches user:* human senders and peer_id in personal wiki cards", async () => {
    const workspace = await fixture();
    await put(
      workspace,
      "wiki/entities/characters/sensei.md",
      "---\npeer_id: user:sensei\nname: Sensei\n---\n## Quick Impression\nReliable club advisor.\n\n## Interaction Log\nHelped with baking.",
    );
    const found = await readPersonalWiki(
      workspace,
      ["user:sensei"],
      "Did you see Sensei?",
      2,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("Reliable club advisor.");
    expect(found[0]).not.toContain("Helped with baking.");
  });
});
