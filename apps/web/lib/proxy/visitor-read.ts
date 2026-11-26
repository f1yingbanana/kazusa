import { VIEWER_ROLE_HEADER } from "@kazusa/client";
import { cacheLife } from "next/cache";

/** The Gateway's answer, whole: 200 or its refusal, passed on as it is. */
export interface Answer {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

const TIMEOUT_MS = 30_000;

/**
 * What a visitor reads from the Gateway, kept in Next's cache: every visitor is
 * shown the same, so Next shares one read among everyone asking and keeps its
 * answer for a second.
 *
 * `changes` (`world-changes.ts`) is only there to be part of the cache key: a
 * read asked for after an event is a new entry, never the answer from before
 * it. No answer at all (a timeout, a dropped connection) throws.
 */
export async function readShared(
  path: string,
  changes: number,
): Promise<Answer> {
  "use cache";
  cacheLife({ revalidate: 1, expire: 2 });
  void changes;
  const base = (
    process.env.KAZUSA_GATEWAY_URL ?? "http://127.0.0.1:18789"
  ).replace(/\/+$/, "");
  const token = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (!token) throw new Error("The Kazusa Gateway credential is missing.");
  const response = await fetch(new URL(`${base}/kazusa/${path}`), {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      [VIEWER_ROLE_HEADER]: "visitor",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "application/json",
    body: await response.text(),
  };
}
