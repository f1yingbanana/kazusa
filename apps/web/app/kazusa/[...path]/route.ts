import {
  hasPermission,
  KAZUSA_ROUTES,
  VIEWER_ROLE_HEADER,
} from "@kazusa/client";
import {
  accessError,
  AuthError,
  hostError,
  hostOf,
  isAllowedHost,
  resolveViewer,
} from "../../../lib/auth/access";
import { readShared } from "../../../lib/proxy/visitor-read";
import {
  noteEvent,
  watchEvents,
  worldChanges,
} from "../../../lib/proxy/world-changes";
import { isSameOrigin } from "../../../lib/same-origin";

/**
 * Never kept: streams and pictures go straight through, and the world's answer
 * carries the server's reading of the clock.
 */
const PASSED_THROUGH: ReadonlySet<string> = new Set([
  "events",
  "avatar",
  "sticker",
  "portrait",
  "backdrop",
  "world",
]);
type Context = { params: Promise<{ path: string[] }> };

async function forward(request: Request, context: Context): Promise<Response> {
  const route = (await context.params).path.join("/");
  let viewer;
  try {
    viewer = resolveViewer(request);
    if (!isAllowedHost(hostOf(request))) return hostError();
  } catch (err) {
    if (err instanceof AuthError) {
      return accessError(err.status, err.message);
    }
    return accessError(
      503,
      "Kazusa authentication is not configured correctly.",
    );
  }
  // Per-viewer data must never become part of a shared world snapshot cache.
  if (route === "access") {
    if (request.method !== "GET")
      return new Response(null, { status: 405, headers: { Allow: "GET" } });
    return Response.json(viewer, { headers: { "Cache-Control": "no-store" } });
  }
  const policy = KAZUSA_ROUTES.get(route);
  if (!policy?.proxy)
    return Response.json({ error: "Unknown Kazusa route." }, { status: 404 });
  const { method, permission } = policy;
  if (request.method !== method)
    return new Response(null, { status: 405, headers: { Allow: method } });
  if (!hasPermission(viewer.role, permission)) {
    return accessError(403, "Your access does not allow this action.");
  }
  if (request.method === "POST" && !isSameOrigin(request)) {
    return Response.json(
      { error: "Use the same origin for this request." },
      { status: 403 },
    );
  }
  const base = (
    process.env.KAZUSA_GATEWAY_URL ?? "http://127.0.0.1:18789"
  ).replace(/\/+$/, "");
  const target = new URL(`${base}/kazusa/${route}`);
  target.search = new URL(request.url).search;
  // Credentials and delegated identity come from the server, never the URL.
  target.searchParams.delete("token");
  // A picture goes on as its bytes, with the type the browser gave it.
  const headers = new Headers({
    "Content-Type": policy.upload
      ? (request.headers.get("content-type") ?? "application/octet-stream")
      : "application/json",
  });
  const token = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (!token)
    return accessError(503, "The Kazusa Gateway credential is missing.");
  headers.set("Authorization", `Bearer ${token}`);
  headers.set(VIEWER_ROLE_HEADER, viewer.role);
  // Every visitor is shown the same: one read, kept in Next's cache, answers
  // all of them (`visitor-read`).
  if (
    method === "GET" &&
    viewer.role === "visitor" &&
    !PASSED_THROUGH.has(route)
  ) {
    try {
      const answer = await readShared(
        `${route}${target.search}`,
        worldChanges(),
      );
      return new Response(answer.body, {
        status: answer.status,
        headers: {
          "Content-Type": answer.contentType,
          "Cache-Control": "no-cache",
        },
      });
    } catch {
      // No answer at all: the one try was shared by everyone asking, so a
      // struggling Gateway isn't asked again per reader.
      return Response.json(
        { error: "Could not reach the Kazusa Gateway." },
        { status: 502 },
      );
    }
  }
  try {
    const response = await fetch(target, {
      method,
      headers,
      cache: "no-store",
      signal: request.signal,
      body:
        method !== "POST"
          ? undefined
          : policy.upload
            ? await request.arrayBuffer()
            : await request.text(),
    });
    const contentType =
      response.headers.get("content-type") ?? "application/json";
    // Only the event stream must reach the browser untouched, chunk by chunk.
    // `no-transform` on anything else just stops this server and any CDN in
    // front of it from compressing JSON that runs to hundreds of kilobytes.
    const stream = contentType.startsWith("text/event-stream");
    // A write changes the world before any stream says so.
    if (method === "POST" && response.ok) noteEvent("write");
    return new Response(
      // Each event counts as a change to the world (`world-changes`).
      stream && response.body ? watchEvents(response.body) : response.body,
      {
        status: response.status,
        headers: {
          "Content-Type": contentType,
          "Cache-Control":
            response.headers.get("cache-control") ??
            (stream ? "no-cache, no-transform" : "no-cache"),
          ...(stream ? { "X-Accel-Buffering": "no" } : {}),
        },
      },
    );
  } catch {
    return Response.json(
      { error: "Could not reach the Kazusa Gateway." },
      { status: 502 },
    );
  }
}

export const GET = forward;
export const POST = forward;
