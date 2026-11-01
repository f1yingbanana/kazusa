import {
  BrainTraceResponseSchema,
  UsageResponseSchema,
  type BrainTraceResponse,
  type UsageResponse,
} from "@kazusa/client";
import { buildUrl, request } from "../http";

export async function fetchBrainTrace(
  baseUrl: string,
  token: string | undefined,
  id: string,
  limit: number,
): Promise<BrainTraceResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/brain/trace", { id, limit }),
    undefined,
    token,
  );
  return BrainTraceResponseSchema.parse(data);
}

export async function fetchUsage(
  baseUrl: string,
  token: string | undefined,
  days: number,
): Promise<UsageResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/usage", { days }),
    undefined,
    token,
  );
  return UsageResponseSchema.parse(data);
}
