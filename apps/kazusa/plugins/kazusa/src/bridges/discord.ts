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
import {
  MissingPermission,
  type BridgeTransport,
  type TransportHandlers,
} from "./bridge.ts";

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
export const LINK_CODE = /^\s*([A-Za-z0-9]{6})\s*$/;

/** The mark on a message nobody in Kazusa heard. */
const UNDELIVERED = "🚫";

/**
 * Close codes Discord ends a connection with for good: a bad token (4004),
 * intents it doesn't know (4013) or won't give this bot (4014).
 */
const REFUSALS: Readonly<Record<number, string>> = {
  4004: "Discord refused the token.",
  4013: "Discord refused the bot's intents.",
  4014: "Discord refused the Message Content intent: switch it on under Bot in the Developer Portal.",
};

/**
 * A webhook name Discord takes: at most 80 characters, and never "discord" or
 * "clyde", which it refuses outright (so a character named for one would post
 * nothing). A zero-width joiner breaks the word up without changing how it
 * reads.
 */
export function webhookName(name: string): string {
  const safe = name
    .replace(/discord|clyde/gi, (word) => `${word[0]}\u200d${word.slice(1)}`)
    .trim();
  return Array.from(safe).slice(0, 80).join("") || "Someone";
}

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
export function readable(
  data: Pick<GatewayMessageCreateDispatchData, "content" | "mentions">,
): string {
  let text = data.content;
  for (const user of data.mentions) {
    const name =
      user.member?.nick ?? user.global_name ?? user.username ?? "someone";
    // A function, so a name like `$&` is put in as written, not as a pattern.
    text = text.replaceAll(`<@${user.id}>`, () => `@${name}`);
    text = text.replaceAll(`<@!${user.id}>`, () => `@${name}`);
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
  /** Webhooks found or made, as opposed to still being looked up. */
  const found = new WeakSet<Promise<{ id: string; token: string }>>();
  /**
   * Forgets a channel's webhook so the next use looks it up again (deleted in
   * Discord), unless it is still being looked up or made: two lookups at once
   * would each make one.
   */
  const forgetWebhook = (channelId: string) => {
    const hook = webhooks.get(channelId);
    if (hook && found.has(hook)) webhooks.delete(channelId);
  };
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
      const pending = hook;
      // A failure is tried again with the next line, not kept, unless a newer
      // lookup has taken its place.
      pending.then(
        () => found.add(pending),
        () => {
          if (webhooks.get(channelId) === pending) webhooks.delete(channelId);
        },
      );
      webhooks.set(channelId, pending);
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
      // An emitter's unheard error is thrown; a connection's is only told.
      gateway.on(WebSocketShardEvents.Error, (error) => {
        warn(`Bridge: Discord connection: ${String(error)}`);
      });
      let refusal: string | undefined;
      let started = false;
      const closed = new Promise<never>((_, reject) => {
        gateway.on(WebSocketShardEvents.Closed, (code) => {
          refusal = REFUSALS[code];
          if (!refusal) return;
          // After start-up the connection was working: it ends now.
          if (started) handlers.lost(refusal);
          else reject(new Error(refusal));
        });
      });
      const ready = new Promise<void>((resolve) =>
        gateway.on(WebSocketShardEvents.Ready, () => resolve()),
      );
      const connecting = gateway.connect().then(() => ready);
      // Whichever loses the race below still settles; a rejection nobody
      // hears stops the whole Gateway (OpenClaw exits on one).
      closed.catch(() => {});
      connecting.catch(() => {});
      try {
        await Promise.race([connecting, closed]);
        started = true;
      } catch (error) {
        // A refused connection also fails `connect()`, with Discord's words.
        throw refusal ? new Error(refusal) : error;
      }
      return { name: me.global_name ?? me.username };
    },
    async post(channelId, line) {
      const execute = async () => {
        const hook = await webhookFor(channelId);
        await client.api.webhooks.execute(hook.id, hook.token, {
          // Answered once Discord has kept the message, so a line it didn't
          // keep fails here rather than passing for posted.
          wait: true,
          content: line.text,
          username: webhookName(line.name),
          ...(line.avatarUrl ? { avatar_url: line.avatarUrl } : {}),
          // A character never pings anyone, @everyone included.
          allowed_mentions: { parse: [] },
        });
      };
      try {
        await execute();
      } catch (error) {
        // The webhook was deleted or reset in Discord: make it again, once.
        const status = statusOf(error);
        if (status !== 404 && status !== 401) throw error;
        forgetWebhook(channelId);
        await execute();
      }
    },
    async typing(channelId) {
      await client.api.channels.showTyping(channelId);
    },
    async remove(channelId, messageId) {
      try {
        await client.api.channels.deleteMessage(channelId, messageId);
      } catch (error) {
        // Gone already: what was wanted.
        if (statusOf(error) === 404) return;
        throw statusOf(error) === 403 ? new MissingPermission() : error;
      }
    },
    async markUndelivered(line, reason) {
      await client.api.channels
        .addMessageReaction(line.channelId, line.messageId, UNDELIVERED)
        .catch((error: unknown) => {
          warn(`Bridge: couldn't mark a message undelivered: ${String(error)}`);
        });
      if (!reason) return;
      // Told to them alone; someone who allows no direct messages isn't.
      await client.api.users
        .createDM(line.author.id)
        .then((dm) =>
          client.api.channels.createMessage(dm.id, { content: reason }),
        )
        .catch(() => {});
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
      // Looked up afresh: a webhook deleted in Discord is made again.
      forgetWebhook(channelId);
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
