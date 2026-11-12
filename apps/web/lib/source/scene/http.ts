import {
  PortraitsResponseSchema,
  type PortraitsResponse,
} from "@kazusa/client";
import { buildUrl, request } from "../http";

export const PORTRAITS_KEY = "kazusa/portraits";

/** A character's portrait set; empty for a character without portraits. */
export async function fetchPortraits(id: string): Promise<PortraitsResponse> {
  const data = await request<unknown>(buildUrl("/kazusa/portraits", { id }));
  return PortraitsResponseSchema.parse(data);
}
