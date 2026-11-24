import { beforeEach, describe, expect, it, vi } from "vitest";

interface Fake {
  /** How the fake gateway behaves on `connect()`. */
  connect: "ready" | "refused";
  executed: { id: string; username: string }[];
  executeFailures: number;
  webhooks: { id: string; token: string; application_id: string }[];
  made: number;
}

/** How the fake gateway behaves, and what the fake API did. */
const fake = vi.hoisted((): Fake => ({
  connect: "ready",
  executed: [],
  executeFailures: 0,
  webhooks: [],
  made: 0,
}));

vi.mock("@discordjs/ws", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@discordjs/ws")>();
  const { EventEmitter } = await import("node:events");
  const { WebSocketShardEvents } = actual;
  class FakeManager extends EventEmitter {
    async connect(): Promise<void> {
      if (fake.connect === "ready") {
        queueMicrotask(() => this.emit(WebSocketShardEvents.Ready, {}, 0));
        return;
      }
      // As @discordjs/ws does on 4014: closed, then error, then a rejection.
      this.emit(WebSocketShardEvents.Closed, 4014, 0);
      this.emit(
        WebSocketShardEvents.Error,
        new Error("Used disallowed intents"),
        0,
      );
      throw new Error("Used disallowed intents");
    }
    async destroy(): Promise<void> {}
  }
  return { ...actual, WebSocketManager: FakeManager };
});

vi.mock("@discordjs/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@discordjs/core")>();
  const { EventEmitter } = await import("node:events");
  class FakeClient extends EventEmitter {
    api = {
      users: {
        getCurrent: async () => ({ username: "office", global_name: null }),
      },
      applications: { getCurrent: async () => ({ id: "app" }) },
      applicationCommands: { createGlobalCommand: async () => ({}) },
      channels: {
        getWebhooks: async () => fake.webhooks,
        createWebhook: async () => {
          fake.made += 1;
          const hook = {
            id: `hook${fake.made}`,
            token: "t",
            application_id: "app",
          };
          fake.webhooks = [hook];
          return hook;
        },
      },
      webhooks: {
        execute: async (
          id: string,
          _token: string,
          body: { username: string },
        ) => {
          if (fake.executeFailures > 0) {
            fake.executeFailures -= 1;
            // A webhook deleted in Discord.
            fake.webhooks = [];
            throw Object.assign(new Error("Unknown Webhook"), { status: 404 });
          }
          fake.executed.push({ id, username: body.username });
        },
      },
    };
  }
  return { ...actual, Client: FakeClient };
});

const { discordTransport, LINK_CODE, readable, webhookName } =
  await import("./discord.ts");

const handlers = { line: () => {}, link: async () => "" };

beforeEach(() => {
  fake.connect = "ready";
  fake.executed = [];
  fake.executeFailures = 0;
  fake.webhooks = [];
  fake.made = 0;
});

describe("discordTransport", () => {
  it("says Discord refused the intent, and leaves no rejection unheard", async () => {
    fake.connect = "refused";
    const unheard = vi.fn();
    process.on("unhandledRejection", unheard);
    try {
      await expect(discordTransport("token").start(handlers)).rejects.toThrow(
        "Message Content intent",
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unheard).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unheard);
    }
  });

  it("connects, and makes a webhook again when Discord deleted it", async () => {
    const discord = discordTransport("token");
    expect(await discord.start(handlers)).toEqual({ name: "office" });
    await discord.post("111", { name: "Hina", text: "Hello" });
    fake.executeFailures = 1;
    await discord.post("111", { name: "Hina", text: "Again" });
    expect(fake.made).toBe(2);
    expect(fake.executed.map(({ id }) => id)).toEqual(["hook1", "hook2"]);
  });
});

describe("webhookName", () => {
  it("is a name Discord takes", () => {
    expect(webhookName("Hina")).toBe("Hina");
    expect(webhookName("Discord Clyde")).not.toMatch(/discord|clyde/i);
    expect(webhookName("Discord Clyde").replaceAll("‍", "")).toBe(
      "Discord Clyde",
    );
    expect(Array.from(webhookName("x".repeat(100)))).toHaveLength(80);
    expect(webhookName("   ")).toBe("Someone");
  });
});

describe("readable", () => {
  it("names mentions instead of numbering them", () => {
    expect(
      readable({
        content: "hi <@1> and <@!2>",
        mentions: [
          { id: "1", username: "a", global_name: "Ann" },
          {
            id: "2",
            username: "b",
            global_name: null,
            member: { nick: "Bee" },
          },
        ] as Parameters<typeof readable>[0]["mentions"],
      }),
    ).toBe("hi @Ann and @Bee");
  });
});

describe("LINK_CODE", () => {
  it("takes a code alone in a message, and nothing else", () => {
    expect(LINK_CODE.exec("  AB12CD ")?.[1]).toBe("AB12CD");
    expect(LINK_CODE.exec("link AB12CD")).toBeNull();
    expect(LINK_CODE.exec("AB12CDE")).toBeNull();
  });
});
