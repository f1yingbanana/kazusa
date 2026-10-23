import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { z } from "zod";
import { Clock } from "./clock.ts";
import type { ClockPersistedRecord, ClockSnapshot } from "./types.ts";

const speedParams = z
  .object({ speed: z.number().finite().nonnegative() })
  .strict();
const advanceParams = z
  .object({ minutes: z.number().finite().positive() })
  .strict();

/** Registers Clock's tools, Gateway methods, and persistence hooks. */
export function registerClock(api: OpenClawPluginApi): Clock {
  const store = api.runtime.state.openKeyedStore<ClockPersistedRecord>({
    namespace: "clock",
    retention: "retained",
  });
  const clock = new Clock({ store });
  // Plugin registration is synchronous in OpenClaw. Start loading immediately;
  // each asynchronous use awaits the same idempotent initialization promise.
  void clock.init().catch((): void => {});

  api.registerTool({
    name: "clock_now",
    label: "Simulation Time",
    description:
      "Exceptional system authority over simulation time. Use only when your character is explicitly established as having temporal powers.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      await clock.init();
      const snapshot = clock.now();
      return clockResult(
        `Current simulation time: ${snapshot.formatted}. Speed: ${snapshot.speed}x`,
        snapshot,
      );
    },
  });

  api.registerTool({
    name: "clock_set_speed",
    label: "Set Clock Speed",
    description:
      "Exceptional system authority over simulation time. Use only when your character is explicitly established as having temporal powers.",
    parameters: {
      type: "object",
      properties: {
        speed: {
          type: "number",
          description:
            "New speed multiplier (0 = stop time, 1 = normal time, >1 = accelerated)",
        },
      },
      required: ["speed"],
      additionalProperties: false,
    },
    async execute(_id, params: { speed: number }) {
      await clock.init();
      const snapshot = await clock.setSpeed(params.speed);
      return clockResult(
        `Simulation speed set to ${snapshot.speed}x. Current time: ${snapshot.formatted}`,
        snapshot,
      );
    },
  });

  api.registerTool({
    name: "clock_advance",
    label: "Advance Simulation Time",
    description:
      "Exceptional system authority over simulation time. Use only when your character is explicitly established as having temporal powers.",
    parameters: {
      type: "object",
      properties: {
        minutes: {
          type: "number",
          description: "Positive simulated minutes to advance",
        },
      },
      required: ["minutes"],
      additionalProperties: false,
    },
    async execute(_id, params: { minutes: number }) {
      await clock.init();
      try {
        const snapshot = await clock.advance(params.minutes);
        return clockResult(
          `Simulation advanced to ${snapshot.formatted}.`,
          snapshot,
        );
      } catch (error: unknown) {
        return errorResult("advancing clock", error);
      }
    },
  });

  api.registerGatewayMethod("clock.now", async ({ respond }) => {
    await clock.init();
    respond(true, clock.now(), undefined);
  });
  api.registerGatewayMethod("clock.time", async ({ respond }) => {
    await clock.init();
    respond(true, { time: clock.time() }, undefined);
  });
  api.registerGatewayMethod("clock.setSpeed", async ({ params, respond }) => {
    await clock.init();
    const parsed = speedParams.safeParse(params);
    if (!parsed.success) {
      respond(false, undefined, {
        code: "INVALID_ARGUMENT",
        message: "speed must be a non-negative finite number",
      });
      return;
    }
    try {
      respond(true, await clock.setSpeed(parsed.data.speed), undefined);
    } catch (error: unknown) {
      respond(false, undefined, executionError(error));
    }
  });
  api.registerGatewayMethod("clock.advance", async ({ params, respond }) => {
    await clock.init();
    const parsed = advanceParams.safeParse(params);
    if (!parsed.success) {
      respond(false, undefined, {
        code: "INVALID_ARGUMENT",
        message: "minutes must be a positive finite number",
      });
      return;
    }
    try {
      respond(true, await clock.advance(parsed.data.minutes), undefined);
    } catch (error: unknown) {
      respond(false, undefined, executionError(error));
    }
  });

  // Capture elapsed real time before a turn uses the clock, so a restart resumes
  // from the current simulated instant without advancing it during downtime.
  api.on("before_prompt_build", async (): Promise<void> => {
    await clock.init();
    await clock.persist();
  });
  // Flush the final wall-clock anchor on orderly Gateway shutdown.
  api.on("gateway_stop", async (): Promise<void> => {
    await clock.init();
    await clock.close();
  });

  return clock;
}

function clockResult(
  text: string,
  snapshot: ClockSnapshot,
): {
  content: Array<{ type: "text"; text: string }>;
  details: ClockSnapshot;
} {
  return { content: [{ type: "text", text }], details: snapshot };
}

function errorResult(
  action: string,
  error: unknown,
): {
  content: Array<{ type: "text"; text: string }>;
  details: { error: string };
} {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `Error ${action}: ${message}` }],
    details: { error: message },
  };
}

function executionError(error: unknown): { code: string; message: string } {
  return {
    code: "EXECUTION_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}
