import {
  ApplicationCommandOptionType,
  ChannelType,
  Client,
  GatewayDispatchEvents,
  GatewayIntentBits,
  InteractionType,
  MessageFlags,
  type GatewayMessageCreateDispatchData,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "@discordjs/core";
import { REST } from "@discordjs/rest";
import { WebSocketManager, WebSocketShardEvents } from "@discordjs/ws";
import type { BridgeTransport, TransportHandlers } from "./bridge.ts";

/**
 * What the bot reads: servers, their messages and what the messages say, and
 * direct messages, where people send it link codes.
 */
const INTENTS =
  GatewayIntentBits.Guilds |
  GatewayIntentBits.GuildMessages |
  GatewayIntentBits.MessageContent |
  GatewayIntentBits.DirectMessages;

/** A link code as Kazusa shows it: six letters and digits. */
const LINK_CODE = /^\s*([A-Za-z0-9]{6})\s*$/;

/** `/link`: someone proves a Discord account is theirs with Kazusa's code. */
const LINK_COMMAND: RESTPostAPIChatInputApplicationCommandsJSONBody = {
  name: "link",
  description:
    "Link your Discord account to Kazusa, with the code it shows you",
  options: [
    {
      type: ApplicationCommandOptionType.String,
      name: "code",
      description: "The six-letter code from Kazusa's Settings, Chat apps",
      required: true,
    },
  ],
};

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
export function discordTransport(
  token: string,
  warn: (message: string) => void = () => {},
): BridgeTransport {
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
    async start(handlers: TransportHandlers) {
      // A bad token fails here, before any connection is made.
      const me = await client.api.users.getCurrent();
      applicationId = (await client.api.applications.getCurrent()).id;
      // Made or brought up to date; a refusal leaves direct messages working.
      await client.api.applicationCommands
        .createGlobalCommand(applicationId, LINK_COMMAND)
        .catch((error: unknown) => {
          warn(`Bridge: couldn't make the /link command: ${String(error)}`);
        });
      client.on(GatewayDispatchEvents.InteractionCreate, ({ data }) => {
        if (
          data.type !== InteractionType.ApplicationCommand ||
          data.data.name !== LINK_COMMAND.name
        )
          return;
        const option =
          "options" in data.data
            ? data.data.options?.find((given) => given.name === "code")
            : undefined;
        const code = option && "value" in option ? String(option.value) : "";
        const user = data.member?.user ?? data.user;
        if (!user) return;
        void handlers
          .link(code, { id: user.id, name: user.global_name ?? user.username })
          .then((reply) =>
            client.api.interactions.reply(data.id, data.token, {
              content: reply,
              flags: MessageFlags.Ephemeral,
            }),
          )
          .catch((error: unknown) => {
            warn(`Bridge: couldn't answer /link: ${String(error)}`);
          });
      });
      client.on(GatewayDispatchEvents.MessageCreate, ({ data }) => {
        // Our own posts come back as webhook messages; other bots are skipped.
        if (data.webhook_id || data.author.bot) return;
        if (!data.guild_id) {
          // A direct message: only a link code means anything here.
          const code = LINK_CODE.exec(data.content)?.[1];
          if (!code) return;
          void handlers
            .link(code, {
              id: data.author.id,
              name: data.author.global_name ?? data.author.username,
            })
            .then((reply) =>
              client.api.channels.createMessage(data.channel_id, {
                content: reply,
              }),
            )
            .catch((error: unknown) => {
              warn(`Bridge: couldn't answer a link code: ${String(error)}`);
            });
          return;
        }
        handlers.line({
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
    async remove(channelId, messageId) {
      await client.api.channels.deleteMessage(channelId, messageId);
    },
    async check(channelId) {
      let channel;
      try {
        channel = await client.api.channels.get(channelId);
      } catch (error) {
        const status = statusOf(error);
        if (status === 404)
          return {
            problem:
              "There's no channel with this ID, or the bot isn't in its server.",
          };
        if (status === 403)
          return {
            problem:
              "The bot can't see this channel, so nothing written there reaches the group. In Discord, allow it View Channel and Read Message History in the channel's permissions.",
          };
        throw error;
      }
      const guildId = "guild_id" in channel ? channel.guild_id : undefined;
      const server = guildId
        ? await client.api.guilds
            .get(guildId)
            .then((guild) => guild.name)
            .catch(() => undefined)
        : undefined;
      const found = {
        ...(channel.name ? { name: channel.name } : {}),
        ...(server ? { server } : {}),
      };
      if (
        channel.type !== ChannelType.GuildText &&
        channel.type !== ChannelType.GuildAnnouncement
      )
        return {
          ...found,
          problem: "Only a server's text channel can be linked.",
        };
      try {
        await webhookFor(channelId);
      } catch (error) {
        if (statusOf(error) === 403)
          return {
            ...found,
            problem:
              "The bot can't post as characters here. In Discord, allow it Manage Webhooks in the channel's permissions.",
          };
        throw error;
      }
      return found;
    },
    async stop() {
      client.removeAllListeners();
      await gateway.destroy();
    },
  };
}
