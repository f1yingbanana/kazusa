import {
  accessForRole,
  deploymentRole,
  parseAuthMode,
  type Access,
} from "@kazusa/client";
import { isSameOrigin } from "../same-origin";

/** Server-only deployment choice. Browser-supplied identity is never trusted. */
export function resolveViewer(): Access {
  return accessForRole(
    deploymentRole(parseAuthMode(process.env.KAZUSA_AUTH_MODE)),
  );
}

/** Loopback names, as `scripts/dev.mjs` binds the desktop frontend. */
const LOOPBACK_HOST =
  /^(localhost|[a-z0-9-]+\.localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * Local mode answers only to loopback names, so a page whose DNS name was
 * rebound to 127.0.0.1 can't use the owner's proxy. Ownership still comes from
 * the mode, never from the Host; public frontends serve any domain.
 */
export function isAllowedHost(host: string | null): boolean {
  if (parseAuthMode(process.env.KAZUSA_AUTH_MODE) !== "local") return true;
  return host !== null && LOOPBACK_HOST.test(host);
}

/** Next always sends `Host`; a bare `Request` (tests) only has its URL. */
export function hostOf(request: Request): string {
  return request.headers.get("host") ?? new URL(request.url).host;
}

export function accessError(status: number, error: string): Response {
  return Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function hostError(): Response {
  return accessError(403, "Open Kazusa at localhost.");
}

/** Desktop host operations are unavailable on a public deployment. */
export function requireLocalOwner(request: Request): Response | undefined {
  try {
    if (resolveViewer().role !== "owner") {
      return accessError(
        403,
        "This action is only available to the local owner.",
      );
    }
    if (!isAllowedHost(hostOf(request))) return hostError();
  } catch {
    return accessError(
      503,
      "Kazusa authentication is not configured correctly.",
    );
  }
  if (!isSameOrigin(request))
    return accessError(403, "Use the same origin for this request.");
  return undefined;
}
