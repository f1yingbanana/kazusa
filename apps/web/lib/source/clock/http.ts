import {
  ClockResponseSchema,
  WorldResponseSchema,
  type ClockActionPayload,
  type ClockResponse,
  type WorldResponse,
} from "@kazusa/client";
import { buildUrl, request } from "../http";

export async function fetchWorld(): Promise<WorldResponse> {
  const data = await request<unknown>(buildUrl("/kazusa/world"));
  return WorldResponseSchema.parse(data);
}

/**
 * `keepalive`: the request outlives the page (sent as it is being left, so a
 * world paused by this page is not left paused).
 */
export async function executeClockAction(
  action: ClockActionPayload,
  { keepalive = false }: { keepalive?: boolean } = {},
): Promise<ClockResponse> {
  const data = await request<unknown>(buildUrl("/kazusa/clock"), {
    method: "POST",
    body: JSON.stringify(action),
    ...(keepalive ? { keepalive } : {}),
  });
  return ClockResponseSchema.parse(data);
}
