import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import {
  ClockActionPayloadSchema,
  VisitorNoteSchema,
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
  watchesOnly,
} from "../http/helpers.ts";
import { operatorOf } from "../identity.ts";
import type { Player } from "../player.ts";
import { z } from "zod";

const WorldConfigSchema = z.object({
  title: z.string().optional(),
  summary: z.string().optional(),
  accent: z.string().optional(),
  visitorNote: VisitorNoteSchema.optional().catch(undefined),
});

/** How `config.world` names the world; a malformed note is left out, not fatal. */
export function worldConfigOf(
  config: unknown,
): z.infer<typeof WorldConfigSchema> {
  const parsed = WorldConfigSchema.safeParse(config ?? {});
  return parsed.success ? parsed.data : {};
}

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

  route("world", "GET", async (_req, res, role) => {
    await clock.init();
    const clockState = toClockState(clock);
    const named = worldConfigOf(api.pluginConfig?.world);
    const worldMeta: WorldMeta = options?.getWorldMeta
      ? await options.getWorldMeta()
      : {
          title: named.title ?? "Kivotos",
          summary: named.summary ?? "Kazusa multi-agent roleplay society",
          accent: named.accent,
          visitorNote: named.visitorNote,
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
      // Who the operator plays is theirs: someone watching plays nobody.
      player: watchesOnly(role)
        ? null
        : ((await options?.player?.playing()) ?? null),
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
