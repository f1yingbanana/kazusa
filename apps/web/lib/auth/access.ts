import { timingSafeEqual } from "node:crypto";
import {
  accessForRole,
  parseAuthMode,
  PROXY_SECRET_HEADER,
  RoleSchema,
  VIEWER_ROLE_HEADER,
  type Access,
} from "@kazusa/client";
import { isSameOrigin } from "../same-origin";

export class AuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

function getHeader(
  source: Request | Headers | undefined,
  name: string,
): string | null {
  if (!source) return null;
  if ("headers" in source && source.headers instanceof Headers) {
    return source.headers.get(name);
  }
  if (source instanceof Headers) {
    return source.get(name);
  }
  return null;
}

/**
 * Server-only deployment choice.
 *
 * - In local mode, zero-login owner with local: true.
 * - In public mode, every browser is a visitor with local: false.
 * - In trusted-proxy mode, requires private wrapper authentication with
 *   timing-safe secret check, rejecting forged or duplicate identity headers.
 */
export function resolveViewer(request?: Request | Headers): Access {
  const mode = parseAuthMode(process.env.KAZUSA_AUTH_MODE);
  if (mode === "local") {
    return accessForRole("owner", { local: true });
  }
  if (mode === "public") {
    return accessForRole("visitor", { local: false });
  }
  if (mode === "trusted-proxy") {
    const expectedSecret = (
      process.env.KAZUSA_TRUSTED_PROXY_SECRET ?? process.env.KAZUSA_PROXY_SECRET
    )?.trim();
    if (!expectedSecret) {
      throw new AuthError(
        503,
        "Kazusa authentication is not configured correctly.",
      );
    }
    const proxyHeader = getHeader(request, PROXY_SECRET_HEADER);
    const authHeader = getHeader(request, "authorization");
    let providedSecret: string | null = null;
    if (proxyHeader) {
      providedSecret = proxyHeader.trim();
    } else if (authHeader) {
      const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
      if (match) providedSecret = match[1].trim();
    }
    if (!providedSecret) {
      throw new AuthError(
        401,
        "Unauthorized: Invalid or missing proxy credentials.",
      );
    }
    const actualBuf = Buffer.from(providedSecret);
    const expectedBuf = Buffer.from(expectedSecret);
    if (
      actualBuf.length !== expectedBuf.length ||
      !timingSafeEqual(actualBuf, expectedBuf)
    ) {
      throw new AuthError(
        401,
        "Unauthorized: Invalid or missing proxy credentials.",
      );
    }
    const rawRole = getHeader(request, VIEWER_ROLE_HEADER);
    if (rawRole === null) {
      return accessForRole("visitor", { local: false });
    }
    if (rawRole.includes(",")) {
      throw new AuthError(401, "Invalid or unsupported viewer identity.");
    }
    const parsed = RoleSchema.safeParse(rawRole.trim());
    if (!parsed.success || parsed.data === "collaborator") {
      throw new AuthError(401, "Invalid or unsupported viewer identity.");
    }
    return accessForRole(parsed.data, { local: false });
  }
  throw new AuthError(
    503,
    "Kazusa authentication is not configured correctly.",
  );
}

/** Loopback names, as `scripts/dev.mjs` binds the desktop frontend. */
const LOOPBACK_HOST =
  /^(localhost|[a-z0-9-]+\.localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * Local mode answers only to loopback names, so a page whose DNS name was
 * rebound to 127.0.0.1 can't use the owner's proxy. Ownership still comes from
 * the mode, never from the Host; public and proxy frontends serve any domain.
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

/** Desktop host operations are unavailable on a public or cloud deployment. */
export function requireLocalOwner(request: Request): Response | undefined {
  try {
    const mode = parseAuthMode(process.env.KAZUSA_AUTH_MODE);
    if (mode !== "local") {
      return accessError(
        403,
        "This action is only available to the local owner.",
      );
    }
    const viewer = resolveViewer(request);
    if (viewer.role !== "owner") {
      return accessError(
        403,
        "This action is only available to the local owner.",
      );
    }
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
  if (!isSameOrigin(request))
    return accessError(403, "Use the same origin for this request.");
  return undefined;
}
