import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { z } from "zod";
import { inBackground } from "../background.ts";
import { currentConfig } from "../current-config.ts";
import { characterName } from "../identity.ts";
import { USER } from "./http.ts";
import type { Messaging } from "./messaging.ts";

/** `plugins.entries.kazusa.config.welcome`: a world's first words to the player. */
const WELCOME = z.array(z.string().trim().min(1)).min(1).max(9).optional();

/**
 * The system agent's first message, once. It is written, not generated, so it
 * costs nothing and arrives before any provider has been tried. A world that
 * already has this chat keeps it as it is.
 */
export async function sendWelcome(
  messaging: Pick<Messaging, "listChats" | "speak">,
  welcome: {
    readonly agentId: string;
    readonly agentName: string;
    readonly userId: string;
    readonly messages: readonly string[];
    readonly agents: ReadonlySet<string>;
  },
): Promise<void> {
  const { agentId, agentName, userId, messages, agents } = welcome;
  const chats = await messaging.listChats(agentId, { query: userId });
  if (chats.some((chat) => chat.kind === "direct")) return;
  await messaging.speak(
    agentId,
    agentName,
    { members: [userId], messages: [...messages], requestId: "welcome" },
    undefined,
    agents,
    agentId,
  );
}

export function registerWelcome(
  api: OpenClawPluginApi,
  messaging: Messaging,
): void {
  const messages = WELCOME.parse(api.pluginConfig?.welcome);
  if (!messages) return;
  api.registerService({
    id: "kazusa-welcome",
    // Its later bubbles are paced, and startup shouldn't wait for them.
    start: () => {
      inBackground(
        api,
        async () => {
          const config = currentConfig(api);
          const agentId = config.agents?.defaults?.systemAgent?.agentId;
          if (!agentId) return;
          await sendWelcome(messaging, {
            agentId,
            agentName: await characterName(api, config, agentId),
            userId: USER.parse(api.pluginConfig?.user ?? {}).id,
            messages,
            agents: new Set(listAgentIds(config)),
          });
        },
        (error) => api.logger.warn(`Welcome message failed: ${String(error)}`),
      );
    },
  });
}
