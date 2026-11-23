import { createHash } from "node:crypto";
import { VIEWER_ROLE_HEADER } from "@kazusa/client";
import { cacheLife } from "next/cache";

/**
 * What a visitor reads from the Gateway, kept in Next's cache (`use cache`) so
 * a crowd costs the Gateway what one visitor does. Every visitor is shown the
 * same, so one read answers all of them: Next shares a read among everyone
 * asking while it is under way, and keeps the answer in this server's memory
 * (`cacheMaxMemorySize`).
 *
 * An answer is kept under the count of changes it was read at
 * (`world-changes.ts`), so nothing read before a change is handed out after it.
 * The lifetimes below only bound what no event announces. A refusal is an
 * answer too, kept no longer than live data, so a crowd asking a failing
 * Gateway is still one read a second. No answer at all (a timeout, a refused
 * connection) throws, and the reader gets a 502: never a second try per reader
 * at a Gateway already struggling.
 *
 * Never for an owner: theirs differ, and they must see what they just did. Each
 * function asks as a visitor whatever its caller is.
 */

/** A whole answer: what to send, and what tells a browser it already has it. */
export interface Kept {
  /** The Gateway's own: 200, or its refusal, passed on as it is. */
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
  readonly etag: string;
  /** The count it was read under: part of what it is kept by. */
  readonly changes: number;
}

const TIMEOUT_MS = 30_000;

async function ask(path: string, changes: number): Promise<Kept> {
  const base = process.env.KAZUSA_GATEWAY_URL ?? "http://127.0.0.1:18789";
  const token = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (!token) throw new Error("The Kazusa Gateway credential is missing.");
  const response = await fetch(new URL(`/kazusa/${path}`, base), {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      [VIEWER_ROLE_HEADER]: "visitor",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "application/json",
    body,
    etag: `"${createHash("sha1").update(body).digest("base64url")}"`,
    changes,
  };
}

/**
 * What changes with anything: who is where and doing what, chats, the timeline.
 * Ended by any event; else a second, two at most.
 */
export async function readLive(path: string, changes: number): Promise<Kept> {
  "use cache";
  cacheLife(LIVE);
  return ask(path, changes);
}

const LIVE = { revalidate: 1, expire: 2 };

/**
 * What only an edit changes: the map, pages, the cast's names and looks. Ended
 * by the events that announce an edit; else half a minute, one at most.
 */
export async function readSlow(path: string, changes: number): Promise<Kept> {
  "use cache";
  const kept = await ask(path, changes);
  // A refusal is kept no longer than live data.
  cacheLife(kept.status === 200 ? { revalidate: 30, expire: 60 } : LIVE);
  return kept;
}

/**
 * Whether a browser's `If-None-Match` names this answer: `*`, or the tag in its
 * strong or weak form (RFC 9110 §13.1.2 compares weakly). Our tags are
 * base64url, so no comma can split one.
 */
function alreadyHas(known: string | null, etag: string): boolean {
  if (!known) return false;
  return known
    .split(",")
    .map((tag) => tag.trim())
    .some((tag) => tag === "*" || tag.replace(/^W\//, "") === etag);
}

/**
 * Sends a kept answer to one reader: whole, or nothing when their browser still
 * has it; a refusal as the Gateway gave it. The body goes out as it is, for
 * Next to compress.
 */
export function respond(kept: Kept, request: Request): Response {
  const headers = new Headers({
    "Content-Type": kept.contentType,
    // Kept by the browser, asked about every time: an unchanged answer costs
    // a 304 and no body.
    "Cache-Control": "no-cache",
    // Who is signed in decides what the same address answers.
    Vary: "Cookie",
  });
  if (kept.status !== 200)
    return new Response(kept.body, { status: kept.status, headers });
  headers.set("ETag", kept.etag);
  if (alreadyHas(request.headers.get("if-none-match"), kept.etag))
    return new Response(null, { status: 304, headers });
  return new Response(kept.body, { status: 200, headers });
}
