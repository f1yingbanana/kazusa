import {
  BrainAbortResponseSchema,
  type BrainAbortResponse,
  CharacterDetailResponseSchema,
  CharactersResponseSchema,
  type CharacterDetail,
  type CharacterSummary,
} from "@kazusa/client";
import { buildUrl, request, postJson } from "../http";

export async function fetchCharacters(
  baseUrl: string,
  token?: string,
): Promise<CharacterSummary[]> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/characters"),
    undefined,
    token,
  );
  return CharactersResponseSchema.parse(data).characters;
}

export async function fetchCharacterDetail(
  baseUrl: string,
  id: string,
  token?: string,
): Promise<CharacterDetail> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/character", { id }),
    undefined,
    token,
  );
  return CharacterDetailResponseSchema.parse(data).character;
}

/** Stop current generation; delivered messages and pending input are retained. */
export async function abortCharacterBrain(
  baseUrl: string,
  agentId: string,
  token?: string,
): Promise<BrainAbortResponse> {
  return BrainAbortResponseSchema.parse(
    await postJson<unknown>(
      buildUrl(baseUrl, "/kazusa/brain/abort"),
      { agentId },
      token,
    ),
  );
}
