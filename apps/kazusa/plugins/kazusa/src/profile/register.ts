import { writeWhole } from "../editor/files.ts";
import { systemAgentOf } from "../system-agent.ts";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ProfileSavePayloadSchema, type ProfileResponse } from "@kazusa/client";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { currentConfig } from "../current-config.ts";
import {
  createRouteRegistrar,
  readJsonBody,
  sendJson,
} from "../http/helpers.ts";
import { operatorOf } from "../identity.ts";

/** OpenClaw's own file for who the user is, read into the agent's prompt. */
const USER_FILE = "USER.md";

/**
 * The person at the keyboard, as the system agent knows them. Their id and name
 * come from the world's config; what she knows of them, and so how she
 * addresses them, is theirs to write. It lives in her workspace as `USER.md`,
 * which OpenClaw reads into her every turn: she is the only one who talks to
 * them, and nobody in the world reads it.
 */
export function registerProfile(api: OpenClawPluginApi): void {
  const route = createRouteRegistrar(api);
  const operator = operatorOf(api);

  /** Her `USER.md`, or nothing when the world has no system agent. */
  const file = (): string | undefined => {
    const config = currentConfig(api);
    const agentId = systemAgentOf(config);
    if (!agentId) return undefined;
    return path.join(
      api.runtime.agent.resolveAgentWorkspaceDir(config, agentId),
      USER_FILE,
    );
  };

  const respond = async (): Promise<ProfileResponse> => {
    const target = file();
    const about =
      target && existsSync(target)
        ? (await readFile(target, "utf8")).trim()
        : "";
    return { id: operator.id, name: operator.name, about };
  };

  route("profile", "GET", async (_req, res) => {
    sendJson(res, 200, await respond());
  });

  route("profile/save", "POST", async (req, res) => {
    const { about } = ProfileSavePayloadSchema.parse(await readJsonBody(req));
    const target = file();
    if (!target) throw new Error("This world has no system agent to tell.");
    const body = about.trim();
    writeWhole(target, body ? `${body}\n` : "");
    sendJson(res, 200, await respond());
  });
}
