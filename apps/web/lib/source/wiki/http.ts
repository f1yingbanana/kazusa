import {
  MemoryRunsResponseSchema,
  WikiLintResponseSchema,
  WikiListResponseSchema,
  WikiPageResponseSchema,
  WikiSourceResponseSchema,
  type MemoryRunsResponse,
  type WikiLintResponse,
  type WikiListResponse,
  type WikiKind,
  type WikiPageResponse,
  type WikiSavePayload,
  type WikiSourceResponse,
} from "@kazusa/client";
import { buildUrl, KazusaApiError, postJson, request } from "../http";

export const WIKI_KEY = "kazusa/wiki";

export async function fetchWikiList(
  baseUrl: string,
  token: string | undefined,
  agent?: string,
): Promise<WikiListResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/wiki", { agent }),
    undefined,
    token,
  );
  return WikiListResponseSchema.parse(data);
}

export async function fetchWikiPage(
  baseUrl: string,
  token: string | undefined,
  id: string,
  agent?: string,
): Promise<WikiPageResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/wiki/page", { id, agent }),
    undefined,
    token,
  );
  return WikiPageResponseSchema.parse(data);
}

export async function fetchWikiLint(
  baseUrl: string,
  token: string | undefined,
  agent?: string,
): Promise<WikiLintResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/wiki/lint", { agent }),
    undefined,
    token,
  );
  return WikiLintResponseSchema.parse(data);
}

export async function fetchMemoryRuns(
  baseUrl: string,
  token: string | undefined,
  agent: string,
): Promise<MemoryRunsResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/memory/runs", { agent }),
    undefined,
    token,
  );
  return MemoryRunsResponseSchema.parse(data);
}

export async function fetchWikiSource(
  baseUrl: string,
  token: string | undefined,
  id: string,
  agent?: string,
  kind?: WikiKind,
): Promise<WikiSourceResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/wiki/source", { id, agent, kind }),
    undefined,
    token,
  );
  return WikiSourceResponseSchema.parse(data);
}

/** Someone else wrote the page after it was opened (a night's sleep, a note). */
export class WikiConflictError extends Error {}

export async function saveWikiSource(
  baseUrl: string,
  token: string | undefined,
  payload: WikiSavePayload,
): Promise<WikiSourceResponse> {
  try {
    const data = await postJson<unknown>(
      buildUrl(baseUrl, "/kazusa/wiki/save"),
      payload,
      token,
    );
    return WikiSourceResponseSchema.parse(data);
  } catch (error) {
    if (error instanceof KazusaApiError && error.status === 409)
      throw new WikiConflictError(error.message);
    throw error;
  }
}
