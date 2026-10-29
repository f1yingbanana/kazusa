import type { IncomingMessage, ServerResponse } from "node:http";
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
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
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
  return undefined;
}

export function checkAuth(
  req: IncomingMessage,
  expectedToken?: string,
): boolean {
  if (!expectedToken) return true;
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (match && match[1] === expectedToken) return true;
  }
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const queryToken = url.searchParams.get("token");
    if (queryToken && queryToken === expectedToken) return true;
  } catch {
    // Ignore URL parse errors
  }
  return false;
}

export type RouteRegistrar = (
  path: string,
  method: "GET" | "POST",
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
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
  const expectedToken = auth === "plugin" ? resolveAuthToken(api) : undefined;
  return (
    path: string,
    method: "GET" | "POST",
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  ): void => {
    api.registerHttpRoute({
      path: `/kazusa/${path}`,
      auth,
      match: "exact",
      handler: async (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", `${method}, OPTIONS`);
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization",
        );
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return true;
        }
        if (!checkAuth(req, expectedToken)) {
          sendJson(res, 401, {
            error: "Unauthorized: Invalid or missing gateway token.",
          });
          return true;
        }
        if (req.method !== method) {
          res.setHeader("Allow", `${method}, OPTIONS`);
          sendJson(res, 405, { error: `Use ${method}.` });
          return true;
        }
        try {
          await handler(req, res);
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
