import {
  MemoryRunsResponseSchema,
  WikiLintResponseSchema,
  WikiListResponseSchema,
  WikiPageResponseSchema,
  type MemoryRunsResponse,
  type WikiLintResponse,
  type WikiListResponse,
  type WikiPageResponse,
} from "@kazusa/client";
import { buildUrl, request } from "../http";

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
