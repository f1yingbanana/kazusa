import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { ContextResponse } from "@kazusa/client";
import { createRouteRegistrar, sendJson } from "../http/helpers.ts";
import type { ContextEngineService } from "./register.ts";

/** Serves what each brain turn was given (`GET /kazusa/context?id=`). */
export function registerContextHttp(
  api: OpenClawPluginApi,
  deps: { readonly context: ContextEngineService },
): void {
  createRouteRegistrar(api)("context", "GET", async (req, res) => {
    const id = new URL(req.url ?? "/", "http://localhost").searchParams.get(
      "id",
    );
    if (!id) {
      sendJson(res, 400, { error: "Missing required id query parameter." });
      return;
    }
    sendJson(res, 200, {
      contexts: await deps.context.recentContexts(id),
    } satisfies ContextResponse);
  });
}
