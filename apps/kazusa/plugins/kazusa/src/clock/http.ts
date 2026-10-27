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
import { z } from "zod";
import type { Clock } from "./clock.ts";
import {
  createRouteRegistrar,
  readJsonBody,
  sendJson,
} from "../http/helpers.ts";

const USER = z.object({
  id: z
    .string()
    .regex(/^user:[a-z0-9][a-z0-9_-]*$/)
    .default("user:sensei"),
  name: z.string().trim().min(1).default("Sensei"),
});

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
  },
): void {
  const user = USER.parse(api.pluginConfig?.user ?? {});
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
        };

    const capabilities: Partial<Record<Domain, Capability>> =
      options?.getCapabilities
        ? options.getCapabilities()
        : {
            clock: "live",
            chats: "live",
            characters: "live",
            status: "live",
            timeline: "live",
          };

    sendJson(res, 200, {
      user,
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
