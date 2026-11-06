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
import { isSameOrigin } from "../../../lib/same-origin";

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
  const base = process.env.KAZUSA_GATEWAY_URL ?? "http://127.0.0.1:18789";
  const target = new URL(`/kazusa/${route}`, base);
  target.search = new URL(request.url).search;
  // Credentials and delegated identity come from the server, never the URL.
  target.searchParams.delete("token");
  const headers = new Headers({ "Content-Type": "application/json" });
  const token = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (!token)
    return accessError(503, "The Kazusa Gateway credential is missing.");
  headers.set("Authorization", `Bearer ${token}`);
  headers.set(VIEWER_ROLE_HEADER, viewer.role);
  try {
    const response = await fetch(target, {
      method,
      headers,
      cache: "no-store",
      signal: request.signal,
      body: method === "POST" ? await request.text() : undefined,
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") ?? "application/json",
        "Cache-Control":
          response.headers.get("cache-control") ?? "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return Response.json(
      { error: "Could not reach the Kazusa Gateway." },
      { status: 502 },
    );
  }
}

export const GET = forward;
export const POST = forward;
