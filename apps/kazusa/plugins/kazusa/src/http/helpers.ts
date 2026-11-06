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

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const result = await readJsonBodyWithLimit(req, {
    maxBytes: 256_000,
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
            sendJson(res, 400, {
              error: error instanceof Error ? error.message : String(error),
            });
        }
        return true;
      },
    });
  };
}
