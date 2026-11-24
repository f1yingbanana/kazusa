import {
  ChannelType,
  Client,
  GatewayDispatchEvents,
  GatewayIntentBits,
  type GatewayMessageCreateDispatchData,
} from "@discordjs/core";
import { REST } from "@discordjs/rest";
import { WebSocketManager, WebSocketShardEvents } from "@discordjs/ws";
import type { BridgeTransport, IncomingLine } from "./bridge.ts";

/** What the bot reads: servers, their messages, and what the messages say. */
const INTENTS =
  GatewayIntentBits.Guilds |
  GatewayIntentBits.GuildMessages |
  GatewayIntentBits.MessageContent;

/** Discord's answer to a request it refused: 403 forbidden, 404 not found. */
const statusOf = (error: unknown): number | undefined =>
  typeof error === "object" && error && "status" in error
    ? Number(error.status)
    : undefined;

/** The webhook the bot keeps in each linked channel to post as characters. */
const WEBHOOK_NAME = "Kazusa";

/** A message's text as people read it: mentions by name, not by number. */
function readable(data: GatewayMessageCreateDispatchData): string {
  let text = data.content;
  for (const user of data.mentions) {
    const name =
      user.member?.nick ?? user.global_name ?? user.username ?? "someone";
    text = text.replaceAll(`<@${user.id}>`, `@${name}`);
    text = text.replaceAll(`<@!${user.id}>`, `@${name}`);
  }
  return text;
}

/**
 * One bot token's connection to Discord: it reads what people write in the
 * server channels it can see, and posts as any character through one webhook
 * per channel (a name and a picture per message), so a whole cast needs one
 * bot. Needs the Message Content intent and Manage Webhooks in linked
 * channels.
 */
export function discordTransport(token: string): BridgeTransport {
  const rest = new REST({ version: "10" }).setToken(token);
  const gateway = new WebSocketManager({ token, intents: INTENTS, rest });
  const client = new Client({ rest, gateway });
  const webhooks = new Map<string, Promise<{ id: string; token: string }>>();
  let applicationId: string | undefined;

  /** The bot's own webhook in a channel, made the first time it's needed. */
  const webhookFor = (channelId: string) => {
    let hook = webhooks.get(channelId);
    if (!hook) {
      hook = (async () => {
        const existing = (
          await client.api.channels.getWebhooks(channelId)
        ).find(
          (candidate) =>
            candidate.application_id === applicationId && candidate.token,
        );
        const made =
          existing ??
          (await client.api.channels.createWebhook(channelId, {
            name: WEBHOOK_NAME,
          }));
        if (!made.token) throw new Error("Discord gave the webhook no token.");
        return { id: made.id, token: made.token };
      })();
      // A failure is tried again with the next line, not kept.
      hook.catch(() => webhooks.delete(channelId));
      webhooks.set(channelId, hook);
    }
    return hook;
  };

  return {
    async start(onLine: (line: IncomingLine) => void) {
      // A bad token fails here, before any connection is made.
      const me = await client.api.users.getCurrent();
      applicationId = (await client.api.applications.getCurrent()).id;
      client.on(GatewayDispatchEvents.MessageCreate, ({ data }) => {
        // Our own posts come back as webhook messages; other bots are skipped.
        if (data.webhook_id || data.author.bot || !data.guild_id) return;
        onLine({
          channelId: data.channel_id,
          messageId: data.id,
          author: {
            id: data.author.id,
            name:
              data.member?.nick ??
              data.author.global_name ??
              data.author.username,
          },
          text: readable(data),
        });
      });
      const closed = new Promise<never>((_, reject) => {
        gateway.on(WebSocketShardEvents.Closed, (code) => {
          // 4014: the Message Content intent isn't switched on for the bot.
          if (code === 4014 || code === 4004)
            reject(
              new Error(
                code === 4014
                  ? "Discord refused the Message Content intent: switch it on under Bot in the Developer Portal."
                  : "Discord refused the token.",
              ),
            );
        });
      });
      const ready = new Promise<void>((resolve) =>
        gateway.on(WebSocketShardEvents.Ready, () => resolve()),
      );
      await gateway.connect();
      await Promise.race([ready, closed]);
      return { name: me.global_name ?? me.username };
    },
    async post(channelId, line) {
      const hook = await webhookFor(channelId);
      await client.api.webhooks.execute(hook.id, hook.token, {
        content: line.text,
        username: line.name,
        ...(line.avatarUrl ? { avatar_url: line.avatarUrl } : {}),
        // A character never pings anyone, @everyone included.
        allowed_mentions: { parse: [] },
      });
    },
    async check(channelId) {
      let type: ChannelType;
      try {
        ({ type } = await client.api.channels.get(channelId));
      } catch (error) {
        const status = statusOf(error);
        if (status === 403 || status === 404)
          return "The bot can't see this channel, so nothing written there reaches the group. In Discord, allow it View Channel and Read Message History in the channel's permissions.";
        throw error;
      }
      if (
        type !== ChannelType.GuildText &&
        type !== ChannelType.GuildAnnouncement
      )
        return "Only a server's text channel can be linked.";
      try {
        await webhookFor(channelId);
      } catch (error) {
        if (statusOf(error) === 403)
          return "The bot can't post as characters here. In Discord, allow it Manage Webhooks in the channel's permissions.";
        throw error;
      }
      return undefined;
    },
    async stop() {
      client.removeAllListeners();
      await gateway.destroy();
    },
  };
}
