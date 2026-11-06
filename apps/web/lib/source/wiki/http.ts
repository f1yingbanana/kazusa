import {
  MemoryRunsResponseSchema,
  WikiEditResultSchema,
  WikiLintResponseSchema,
  WikiListResponseSchema,
  WikiPageResponseSchema,
  WikiSourceResponseSchema,
  type MemoryRunsResponse,
  type WikiLintResponse,
  type WikiListResponse,
  type WikiDeletePayload,
  type WikiEditResult,
  type WikiKind,
  type WikiRenamePayload,
  type WikiPageResponse,
  type WikiSavePayload,
  type WikiSourceResponse,
} from "@kazusa/client";
import { buildUrl, KazusaApiError, postJson, request } from "../http";

export const WIKI_KEY = "kazusa/wiki";

export async function fetchWikiList(agent?: string): Promise<WikiListResponse> {
  const data = await request<unknown>(buildUrl("/kazusa/wiki", { agent }));
  return WikiListResponseSchema.parse(data);
}

export async function fetchWikiPage(
  id: string,
  agent?: string,
): Promise<WikiPageResponse> {
  const data = await request<unknown>(
    buildUrl("/kazusa/wiki/page", { id, agent }),
  );
  return WikiPageResponseSchema.parse(data);
}

export async function fetchWikiLint(agent?: string): Promise<WikiLintResponse> {
  const data = await request<unknown>(buildUrl("/kazusa/wiki/lint", { agent }));
  return WikiLintResponseSchema.parse(data);
}

export async function fetchMemoryRuns(
  agent: string,
): Promise<MemoryRunsResponse> {
  const data = await request<unknown>(
    buildUrl("/kazusa/memory/runs", { agent }),
  );
  return MemoryRunsResponseSchema.parse(data);
}

export async function fetchWikiSource(
  id: string,
  agent?: string,
  kind?: WikiKind,
): Promise<WikiSourceResponse> {
  const data = await request<unknown>(
    buildUrl("/kazusa/wiki/source", { id, agent, kind }),
  );
  return WikiSourceResponseSchema.parse(data);
}

/** Someone else wrote the page after it was opened (a night's sleep, a note). */
export class WikiConflictError extends Error {}

export async function saveWikiSource(
  payload: WikiSavePayload,
): Promise<WikiSourceResponse> {
  try {
    const data = await postJson<unknown>(
      buildUrl("/kazusa/wiki/save"),
      payload,
    );
    return WikiSourceResponseSchema.parse(data);
  } catch (error) {
    if (error instanceof KazusaApiError && error.status === 409)
      throw new WikiConflictError(error.message);
    throw error;
  }
}

/** Removes a page; 409 as for a save when it changed since it was read. */
export async function deleteWikiPage(
  payload: WikiDeletePayload,
): Promise<WikiEditResult> {
  try {
    const data = await postJson<unknown>(
      buildUrl("/kazusa/wiki/delete"),
      payload,
    );
    return WikiEditResultSchema.parse(data);
  } catch (error) {
    if (error instanceof KazusaApiError && error.status === 409)
      throw new WikiConflictError(error.message);
    throw error;
  }
}

/** Gives a World Wiki place a new id everywhere. */
export async function renameWikiPage(
  payload: WikiRenamePayload,
): Promise<WikiEditResult> {
  const data = await postJson<unknown>(
    buildUrl("/kazusa/wiki/rename"),
    payload,
  );
  return WikiEditResultSchema.parse(data);
}
