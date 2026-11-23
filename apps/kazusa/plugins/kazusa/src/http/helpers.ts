import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  deploymentRole,
  hasPermission,
  KAZUSA_ROUTES,
  parseAuthMode,
  RoleSchema,
  VIEWER_ROLE_HEADER,
  type Role,
} from "@kazusa/client";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { readJsonBodyWithLimit } from "openclaw/plugin-sdk/webhook-request-guards";

/**
 * Room for a whole text a person writes (a page, MEMORY.md): its length is
 * lint's to weigh in tokens, not a save's to refuse.
 */
export const TEXT_BODY_BYTES = 8_000_000;

export async function readJsonBody(
  req: IncomingMessage,
  maxBytes = 256_000,
): Promise<unknown> {
  const result = await readJsonBodyWithLimit(req, {
    maxBytes,
    timeoutMs: 10_000,
    destroyOnLimit: false,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

export function sendJson(
  res: ServerResponse,
  status: number,
  data: unknown,
): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

export function resolveAuthToken(api: OpenClawPluginApi): string | undefined {
  const auth = (
    api.config as {
      gateway?: {
        auth?: {
          token?: string;
        };
      };
    }
  )?.gateway?.auth;
  if (typeof auth?.token === "string" && auth.token.trim().length > 0) {
    return auth.token.trim();
  }
  return process.env.OPENCLAW_GATEWAY_TOKEN?.trim() || undefined;
}

/** Server-to-server only: the Bearer header, never a URL a browser could leak. */
export function checkAuth(
  req: IncomingMessage,
  expectedToken?: string,
): boolean {
  if (!expectedToken) return false;
  const match = /^Bearer\s+(.+)$/i.exec(
    req.headers.authorization?.trim() ?? "",
  );
  if (!match) return false;
  const actual = Buffer.from(match[1]);
  const expected = Buffer.from(expectedToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Whether a viewer only watches. Without `play` they are nobody in the world,
 * whoever the operator plays: no chat is theirs, and nothing the operator says
 * or is told is shown to them.
 */
export function watchesOnly(role: Role): boolean {
  return !hasPermission(role, "play");
}

export type RouteRegistrar = (
  path: string,
  method: "GET" | "POST",
  handler: (
    req: IncomingMessage,
    res: ServerResponse,
    role: Role,
  ) => Promise<void>,
) => void;

/**
 * `gateway` routes are authenticated by the Gateway itself, which is what lets
 * a handler dispatch Gateway methods as its caller (`gateway-method-runtime`).
 */
export function createRouteRegistrar(
  api: OpenClawPluginApi,
  options?: { readonly auth?: "gateway" | "plugin" },
): RouteRegistrar {
  const auth = options?.auth ?? "plugin";
  const expectedToken = resolveAuthToken(api);
  const mode = parseAuthMode(process.env.KAZUSA_AUTH_MODE);
  return (path, method, handler): void => {
    const policy = KAZUSA_ROUTES.get(path);
    if (!policy || policy.method !== method) {
      throw new Error(
        `Missing Kazusa route policy for ${method} /kazusa/${path}.`,
      );
    }
    api.registerHttpRoute({
      path: `/kazusa/${path}`,
      auth,
      match: "exact",
      handler: async (req, res) => {
        // Gateway-auth routes already passed native authentication. A delegated
        // role additionally requires the private proxy's service credential.
        const delegated = req.headers[VIEWER_ROLE_HEADER];
        if (
          (auth === "plugin" || delegated !== undefined) &&
          !checkAuth(req, expectedToken)
        ) {
          sendJson(res, 401, {
            error: "Unauthorized: Invalid or missing gateway token.",
          });
          return true;
        }
        if (req.method !== method) {
          res.setHeader("Allow", method);
          sendJson(res, 405, { error: `Use ${method}.` });
          return true;
        }
        if (
          Array.isArray(delegated) ||
          (typeof delegated === "string" && delegated.includes(","))
        ) {
          sendJson(res, 401, {
            error: "Invalid or unsupported viewer identity.",
          });
          return true;
        }
        const effective =
          typeof delegated === "string"
            ? delegated.trim()
            : deploymentRole(mode);
        const parsed = RoleSchema.safeParse(effective);
        // Collaborator play is not enabled until player identities are scoped
        // to the authenticated request, including the admin-agent boundary.
        if (!parsed.success || parsed.data === "collaborator") {
          sendJson(res, 401, {
            error: "Invalid or unsupported viewer identity.",
          });
          return true;
        }
        const role = mode === "public" ? "visitor" : parsed.data;
        if (!hasPermission(role, policy.permission)) {
          sendJson(res, 403, {
            error: "Your access does not allow this action.",
          });
          return true;
        }
        try {
          // Resource-specific checks use this authenticated, mode-clamped role.
          await handler(req, res, role);
        } catch (error) {
          if (res.headersSent) res.end();
          else
            // Watching, there is nobody of theirs to act as: a conflict with
            // how things stand, not a bad request.
            sendJson(
              res,
              error instanceof Error && error.name === "WatchingError"
                ? 409
                : 400,
              { error: error instanceof Error ? error.message : String(error) },
            );
        }
        return true;
      },
    });
  };
}
