import { z } from "zod";

export class KazusaApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "KazusaApiError";
    this.status = status;
  }
}

/** True when the backend answered but doesn't have the route (an older plugin). */
export function isMissingRoute(error: unknown) {
  return error instanceof KazusaApiError && error.status === 404;
}

export function buildUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | undefined | null>,
) {
  const url = new URL(
    `${baseUrl.replace(/\/+$/, "")}${path}`,
    typeof window === "undefined" ? undefined : window.location.origin,
  );
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

export async function request<T>(
  url: string,
  init?: RequestInit,
  token?: string,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch {
    throw new KazusaApiError(
      `Could not reach the Kazusa server at ${new URL(url).origin}.`,
    );
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = z
        .object({
          error: z.string().optional(),
          message: z.string().optional(),
        })
        .parse(await response.json());
      detail = body?.error ?? body?.message ?? detail;
    } catch {
      // Non-JSON error bodies fall back to the status text.
    }
    throw new KazusaApiError(
      `Request failed (${response.status})${detail ? `: ${detail}` : ""}`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

export function postJson<T>(url: string, body: unknown, token?: string) {
  return request<T>(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    token,
  );
}
