import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import {
  ClockActionPayloadSchema,
  type Capability,
  type ClockResponse,
  type ClockState,
  type Domain,
  type WorldMeta,
  type WorldResponse,
} from "@kazusa/client";
import type { Clock } from "./clock.ts";
import { availableUpdate, worldCredit } from "../world/package.ts";
import {
  createRouteRegistrar,
  readJsonBody,
  sendJson,
} from "../http/helpers.ts";
import { operatorOf } from "../identity.ts";
import type { Player } from "../player.ts";

/** Domains every Kazusa world serves; others depend on the world's data. */
export const DEFAULT_CAPABILITIES: Readonly<
  Partial<Record<Domain, Capability>>
> = {
  clock: "live",
  chats: "live",
  observe: "live",
  characters: "live",
  status: "live",
  timeline: "live",
  desires: "live",
  stats: "live",
  stage: "live",
  models: "live",
  context: "live",
  profile: "live",
  wiki: "live",
  brain: "live",
  usage: "live",
  scene: "live",
};

export function toClockState(clock: Clock): ClockState {
  const snapshot = clock.now();
  return {
    simTime: snapshot.simTime,
    speed: snapshot.speed,
    updatedAt: Date.now(),
  };
}

export function registerClockHttp(
  api: OpenClawPluginApi,
  clock: Clock,
  options?: {
    readonly getCapabilities?: () => Partial<Record<Domain, Capability>>;
    readonly getWorldMeta?: () => Promise<WorldMeta> | WorldMeta;
    /** Where the world's `package.json` is: the Gateway's working directory. */
    readonly worldDir?: string;
    /** The person at the keyboard and who they play; else nobody's played. */
    readonly player?: Player;
  },
): void {
  const operator = options?.player?.operator ?? operatorOf(api);
  const route = createRouteRegistrar(api);

  route("world", "GET", async (_req, res) => {
    await clock.init();
    const clockState = toClockState(clock);
    const worldMeta: WorldMeta = options?.getWorldMeta
      ? await options.getWorldMeta()
      : {
          title:
            (api.pluginConfig?.world as { title?: string } | undefined)
              ?.title ?? "Kivotos",
          summary:
            (api.pluginConfig?.world as { summary?: string } | undefined)
              ?.summary ?? "Kazusa multi-agent roleplay society",
          accent: (api.pluginConfig?.world as { accent?: string } | undefined)
            ?.accent,
          // Read on each request, so editing the file needs no restart.
          package: worldCredit(options?.worldDir ?? process.cwd()),
          update: availableUpdate(options?.worldDir ?? process.cwd()),
        };

    const capabilities: Partial<Record<Domain, Capability>> =
      options?.getCapabilities
        ? options.getCapabilities()
        : DEFAULT_CAPABILITIES;

    sendJson(res, 200, {
      operator,
      player: (await options?.player?.playing()) ?? null,
      serverNow: Date.now(),
      clock: clockState,
      capabilities,
      world: worldMeta,
    } satisfies WorldResponse);
  });

  route("clock", "POST", async (req, res) => {
    await clock.init();
    const body = ClockActionPayloadSchema.parse(await readJsonBody(req));
    if (body.action === "set_speed") {
      await clock.setSpeed(body.speed);
    } else if (body.action === "advance") {
      await clock.advance(body.minutes);
    }
    sendJson(res, 200, {
      clock: toClockState(clock),
    } satisfies ClockResponse);
  });
}
