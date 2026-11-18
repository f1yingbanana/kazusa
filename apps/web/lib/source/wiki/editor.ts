import { z } from "zod";
import {
  EditedTextSchema,
  WikiBackdropsResponseSchema,
  WikiCharacterResponseSchema,
  WikiPageFormSchema,
  WikiReachResponseSchema,
  WikiSourceResponseSchema,
  type EditedText,
  type WikiBackdropsResponse,
  type WikiCharacterResponse,
  type WikiKind,
  type WikiMemoryPayload,
  type WikiPageForm,
  type WikiPageFormSavePayload,
  type WikiReachResponse,
  type WikiRemovePayload,
  type WikiSourceResponse,
  type WikiStickersPayload,
  type WikiUploadQuery,
} from "@kazusa/client";
import { buildUrl, KazusaApiError, postJson, request } from "../http";
import { WikiConflictError } from "./http";

/*
 * What the Wiki edits beside a page's raw Markdown: a page as a form, and a
 * character's memory, looks and stickers, and the backdrop library.
 */

export const wikiCharacterKey = (id: string) =>
  ["kazusa/wiki/character", id] as const;
export const WIKI_BACKDROPS_KEY = "kazusa/wiki/backdrops";
export const wikiFormKey = (id: string, agent?: string, kind?: WikiKind) =>
  ["kazusa/wiki/form", id, agent ?? "", kind ?? ""] as const;

export async function fetchWikiForm(
  id: string,
  agent?: string,
  kind?: WikiKind,
): Promise<WikiPageForm> {
  const data = await request<unknown>(
    buildUrl("/kazusa/wiki/form", { id, agent, kind }),
  );
  return WikiPageFormSchema.parse(data);
}

/** Saves the form as the page; a page changed meanwhile is a conflict. */
export async function saveWikiForm(
  payload: WikiPageFormSavePayload,
): Promise<WikiSourceResponse> {
  try {
    return WikiSourceResponseSchema.parse(
      await postJson<unknown>(buildUrl("/kazusa/wiki/form/save"), payload),
    );
  } catch (error) {
    if (error instanceof KazusaApiError && error.status === 409)
      throw new WikiConflictError(error.message);
    throw error;
  }
}

export const wikiReachKey = (id: string) => ["kazusa/wiki/reach", id] as const;

/** Who in the cast knows a page how well, as it now stands. */
export async function fetchWikiReach(id: string): Promise<WikiReachResponse> {
  const data = await request<unknown>(buildUrl("/kazusa/wiki/reach", { id }));
  return WikiReachResponseSchema.parse(data);
}

export async function fetchWikiCharacter(
  id: string,
): Promise<WikiCharacterResponse> {
  const data = await request<unknown>(
    buildUrl("/kazusa/wiki/character", { id }),
  );
  return WikiCharacterResponseSchema.parse(data);
}

export async function fetchWikiBackdrops(): Promise<WikiBackdropsResponse> {
  const data = await request<unknown>(buildUrl("/kazusa/wiki/backdrops"));
  return WikiBackdropsResponseSchema.parse(data);
}

export async function saveMemory(
  payload: WikiMemoryPayload,
): Promise<EditedText> {
  return EditedTextSchema.parse(
    await postJson<unknown>(buildUrl("/kazusa/wiki/memory/save"), payload),
  );
}

/**
 * Sends a picture's bytes as they are, typed as the browser read them. The
 * answer is the file's whole name, its extension the type its bytes are.
 */
export async function uploadPicture(
  query: WikiUploadQuery,
  file: Blob,
): Promise<string> {
  const data = await request<unknown>(
    buildUrl("/kazusa/wiki/picture", { ...query }),
    {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    },
  );
  return z.object({ file: z.string() }).parse(data).file;
}

export async function removePicture(payload: WikiRemovePayload): Promise<void> {
  await postJson<unknown>(buildUrl("/kazusa/wiki/picture/remove"), payload);
}

export async function saveStickers(
  payload: WikiStickersPayload,
): Promise<void> {
  await postJson<unknown>(buildUrl("/kazusa/wiki/stickers/save"), payload);
}
