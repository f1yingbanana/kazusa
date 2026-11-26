import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

export const DEFAULT_GATEWAY_URL = "http://127.0.0.1:18789";

export interface GatewayConnectionInfo {
  readonly url: string;
  readonly hasToken: boolean;
  readonly defaultUrl: string;
  readonly isDefault: boolean;
}

export class GatewayConfigError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GatewayConfigError";
  }
}

export function normalizeGatewayUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new GatewayConfigError(400, "Enter the Gateway URL.");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new GatewayConfigError(
      400,
      "Enter a valid http:// or https:// Gateway URL.",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new GatewayConfigError(
      400,
      "Gateway URL must start with http:// or https://.",
    );
  }
  if (parsed.username || parsed.password) {
    throw new GatewayConfigError(
      400,
      "Put the Gateway token in the token field, not inside the URL.",
    );
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}

function formatEnvValue(value: string): string {
  if (/^[A-Za-z0-9_.:/@-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

/**
 * Updates keys in `.env` text in place while preserving comments and other
 * vars.
 */
export function upsertEnvContent(
  existing: string,
  updates: Readonly<Record<string, string>>,
): string {
  const remaining = new Map(Object.entries(updates));
  const lines = existing ? existing.split(/\r?\n/) : [];
  // Drop a single trailing empty split slot so appending doesn't add a blank gap.
  if (lines.at(-1) === "") lines.pop();

  const next = lines.map((line) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!match) return line;
    const key = match[1];
    if (!remaining.has(key)) return line;
    const value = remaining.get(key)!;
    remaining.delete(key);
    return `${key}=${formatEnvValue(value)}`;
  });

  for (const [key, value] of remaining) {
    next.push(`${key}=${formatEnvValue(value)}`);
  }

  return `${next.join("\n")}\n`;
}

function defaultWebDir(): string {
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, "app/kazusa"))) return cwd;
  const nested = path.join(/* turbopackIgnore: true */ cwd, "apps/web");
  return existsSync(path.join(nested, "app/kazusa")) ? nested : cwd;
}

function defaultEnvFiles(): { envFile: string; localWorldEnvFile: string } {
  const webDir = defaultWebDir();
  return {
    envFile: path.join(webDir, ".env.local"),
    localWorldEnvFile: path.resolve(
      /* turbopackIgnore: true */ webDir,
      "../kazusa/world/.state/.env",
    ),
  };
}

function readTokenFromFile(file: string): string | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const parsed = parseEnv(readFileSync(file, "utf8"));
    return parsed.OPENCLAW_GATEWAY_TOKEN?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function readGatewayConnection(): GatewayConnectionInfo {
  const raw = process.env.KAZUSA_GATEWAY_URL?.trim();
  const url = raw ? raw.replace(/\/+$/, "") : DEFAULT_GATEWAY_URL;
  const hasToken = Boolean(process.env.OPENCLAW_GATEWAY_TOKEN?.trim());
  return {
    url,
    hasToken,
    defaultUrl: DEFAULT_GATEWAY_URL,
    isDefault: url === DEFAULT_GATEWAY_URL,
  };
}

export interface SaveGatewayInput {
  readonly url?: string;
  readonly token?: string;
  readonly reset?: boolean;
}

export function saveGatewayConnection(
  input: SaveGatewayInput,
  paths: { envFile?: string; localWorldEnvFile?: string } = {},
): GatewayConnectionInfo {
  const defaults = defaultEnvFiles();
  const envFile = paths.envFile ?? defaults.envFile;
  const localWorldEnvFile =
    paths.localWorldEnvFile ?? defaults.localWorldEnvFile;

  let nextUrl: string;
  let nextToken: string | undefined;

  if (input.reset) {
    nextUrl = DEFAULT_GATEWAY_URL;
    nextToken =
      readTokenFromFile(localWorldEnvFile) ??
      (process.env.OPENCLAW_GATEWAY_TOKEN?.trim() || undefined);
  } else {
    nextUrl = normalizeGatewayUrl(input.url ?? "");
    const typedToken = input.token?.trim();
    nextToken =
      typedToken ||
      process.env.OPENCLAW_GATEWAY_TOKEN?.trim() ||
      readTokenFromFile(envFile) ||
      undefined;
    if (!nextToken) {
      throw new GatewayConfigError(
        400,
        "Enter the Gateway token for this server.",
      );
    }
  }

  const existing = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const updates: Record<string, string> = {
    KAZUSA_GATEWAY_URL: nextUrl,
    ...(nextToken ? { OPENCLAW_GATEWAY_TOKEN: nextToken } : {}),
  };
  mkdirSync(path.dirname(envFile), { recursive: true });
  writeFileSync(envFile, upsertEnvContent(existing, updates), {
    mode: 0o600,
  });

  process.env.KAZUSA_GATEWAY_URL = nextUrl;
  if (nextToken) {
    process.env.OPENCLAW_GATEWAY_TOKEN = nextToken;
  }

  return {
    url: nextUrl,
    hasToken: Boolean(nextToken),
    defaultUrl: DEFAULT_GATEWAY_URL,
    isDefault: nextUrl === DEFAULT_GATEWAY_URL,
  };
}
