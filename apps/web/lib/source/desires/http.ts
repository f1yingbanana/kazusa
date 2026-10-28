import { DesiresResponseSchema, type DesiresResponse } from "@kazusa/client";
import { buildUrl, request } from "../http";

export const DESIRES_KEY = "kazusa/desires";

/** Matches the snapshot's SWR key, so a reconnect can revalidate it. */
export function isDesiresKey(key: unknown) {
  return Array.isArray(key) && key[0] === DESIRES_KEY;
}

export async function fetchDesires(
  baseUrl: string,
  token?: string,
): Promise<DesiresResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/desires"),
    undefined,
    token,
  );
  return DesiresResponseSchema.parse(data);
}
