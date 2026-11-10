import { z } from "zod";

export const RoleSchema = z.enum(["owner", "collaborator", "visitor"]);
export type Role = z.infer<typeof RoleSchema>;

export const PermissionSchema = z.enum(["observe", "play", "manage"]);
export type Permission = z.infer<typeof PermissionSchema>;

/** Viewer access is deliberately separate from world snapshots and player IDs. */
export const AccessSchema = z.object({
  role: RoleSchema,
  permissions: z.array(PermissionSchema),
  local: z.boolean().optional(),
});
export type Access = z.infer<typeof AccessSchema>;

const PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  owner: ["observe", "play", "manage"],
  collaborator: ["observe", "play"],
  visitor: ["observe"],
};

export function accessForRole(
  role: Role,
  options?: { readonly local?: boolean },
): Access {
  return {
    role,
    permissions: [...PERMISSIONS[role]],
    ...(options?.local !== undefined ? { local: options.local } : {}),
  };
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return PERMISSIONS[role].includes(permission);
}

/** Deployment authentication modes. Unknown modes must fail closed. */
export const AuthModeSchema = z.enum(["local", "public", "trusted-proxy"]);
export type AuthMode = z.infer<typeof AuthModeSchema>;

export function parseAuthMode(value: string | undefined): AuthMode {
  return AuthModeSchema.parse(value === undefined ? "local" : value);
}

export function deploymentRole(mode: AuthMode): "owner" | "visitor" {
  return mode === "local" ? "owner" : "visitor";
}

/**
 * Only the authenticated Next-to-Gateway hop or trusted wrapper may supply
 * these headers.
 */
export const VIEWER_ROLE_HEADER = "x-kazusa-role";
export const PROXY_SECRET_HEADER = "x-kazusa-proxy-secret";
export const WORLD_ID_HEADER = "x-kazusa-world-id";

export interface RoutePolicy {
  readonly method: "GET" | "POST";
  readonly permission: Permission;
  /** Whether the browser's Next proxy exposes this plugin route. */
  readonly proxy: boolean;
}

function policy(
  method: RoutePolicy["method"],
  permission: Permission,
  proxy = true,
): RoutePolicy {
  return { method, permission, proxy };
}

/** Every plugin HTTP route needs an explicit policy, including private routes. */
export const KAZUSA_ROUTES: ReadonlyMap<string, RoutePolicy> = new Map([
  ["world", policy("GET", "observe")],
  ["clock", policy("POST", "manage")],
  ["characters", policy("GET", "observe")],
  ["character", policy("GET", "observe")],
  ["agents", policy("GET", "observe")],
  ["chats", policy("GET", "observe")],
  ["messages", policy("GET", "observe")],
  ["observe/chats", policy("GET", "observe")],
  ["observe/messages", policy("GET", "observe")],
  ["events", policy("GET", "observe")],
  ["send", policy("POST", "play")],
  ["chats/manage", policy("POST", "play")],
  ["typing", policy("POST", "play")],
  ["timeline", policy("GET", "observe")],
  ["desires", policy("GET", "observe")],
  ["places", policy("GET", "observe")],
  ["places/positions", policy("POST", "manage")],
  ["locations", policy("GET", "observe")],
  ["move", policy("POST", "play")],
  ["character/stage", policy("POST", "manage")],
  ["avatar", policy("GET", "observe")],
  ["sticker", policy("GET", "observe")],
  ["profile", policy("GET", "observe")],
  ["profile/save", policy("POST", "play")],
  ["context/settings", policy("GET", "manage")],
  ["context/settings/save", policy("POST", "manage")],
  ["models", policy("GET", "manage")],
  ["model", policy("POST", "manage")],
  ["thinking", policy("POST", "manage")],
  ["models/decision", policy("GET", "manage")],
  ["models/decision/select", policy("POST", "manage")],
  ["models/embedding", policy("GET", "manage")],
  ["models/embedding/select", policy("POST", "manage")],
  ["providers", policy("GET", "manage")],
  ["providers/key", policy("POST", "manage")],
  ["providers/remove", policy("POST", "manage")],
  ["brain/abort", policy("POST", "manage")],
  ["brain/trace", policy("GET", "observe")],
  ["usage", policy("GET", "manage")],
  ["wiki", policy("GET", "observe")],
  ["wiki/page", policy("GET", "observe")],
  ["wiki/lint", policy("GET", "observe")],
  ["wiki/source", policy("GET", "observe")],
  ["wiki/save", policy("POST", "manage")],
  ["wiki/delete", policy("POST", "manage")],
  ["wiki/rename", policy("POST", "manage")],
  ["memory/runs", policy("GET", "observe")],
  ["memory/consolidate", policy("POST", "manage", false)],
]);
