import {
  ClockResponseSchema,
  WorldResponseSchema,
  type ClockActionPayload,
  type ClockResponse,
  type WorldResponse,
} from "@kazusa/client";
import { buildUrl, request } from "../http";

export async function fetchWorld(
  baseUrl: string,
  token?: string,
): Promise<WorldResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/world"),
    undefined,
    token,
  );
  return WorldResponseSchema.parse(data);
}

export async function executeClockAction(
  baseUrl: string,
  action: ClockActionPayload,
  token?: string,
): Promise<ClockResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/clock"),
    {
      method: "POST",
      body: JSON.stringify(action),
    },
    token,
  );
  return ClockResponseSchema.parse(data);
}
