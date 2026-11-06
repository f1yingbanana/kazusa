import {
  BrainTraceResponseSchema,
  UsageResponseSchema,
  type BrainTraceResponse,
  type UsageResponse,
} from "@kazusa/client";
import { buildUrl, request } from "../http";

export async function fetchBrainTrace(
  id: string,
  limit: number,
): Promise<BrainTraceResponse> {
  const data = await request<unknown>(
    buildUrl("/kazusa/brain/trace", { id, limit }),
  );
  return BrainTraceResponseSchema.parse(data);
}

export async function fetchUsage(days: number): Promise<UsageResponse> {
  const data = await request<unknown>(buildUrl("/kazusa/usage", { days }));
  return UsageResponseSchema.parse(data);
}
