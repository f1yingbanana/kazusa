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

export async function executeClockAction(
  action: ClockActionPayload,
): Promise<ClockResponse> {
  const data = await request<unknown>(buildUrl("/kazusa/clock"), {
    method: "POST",
    body: JSON.stringify(action),
  });
  return ClockResponseSchema.parse(data);
}
