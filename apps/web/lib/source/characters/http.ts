import {
  BrainAbortResponseSchema,
  type BrainAbortResponse,
  CharacterCreateResponseSchema,
  type CharacterCreatePayload,
  type CharacterCreateResponse,
  CharacterDetailResponseSchema,
  CharactersResponseSchema,
  type CharacterDetail,
  type CharacterSummary,
} from "@kazusa/client";
import { buildUrl, request, postJson } from "../http";

export async function fetchCharacters(): Promise<CharacterSummary[]> {
  const data = await request<unknown>(buildUrl("/kazusa/characters"));
  return CharactersResponseSchema.parse(data).characters;
}

export async function fetchCharacterDetail(
  id: string,
): Promise<CharacterDetail> {
  const data = await request<unknown>(buildUrl("/kazusa/character", { id }));
  return CharacterDetailResponseSchema.parse(data).character;
}

/** Stop current generation; delivered messages and pending input are retained. */
export async function abortCharacterBrain(
  agentId: string,
): Promise<BrainAbortResponse> {
  return BrainAbortResponseSchema.parse(
    await postJson<unknown>(buildUrl("/kazusa/brain/abort"), { agentId }),
  );
}

/** A new character: their page, their workspace, offstage in the cast. */
export async function createCharacter(
  payload: CharacterCreatePayload,
): Promise<CharacterCreateResponse> {
  const data = await postJson<unknown>(
    buildUrl("/kazusa/character/create"),
    payload,
  );
  return CharacterCreateResponseSchema.parse(data);
}

/** Takes a character out of the cast, deleting their page and workspace. */
export async function deleteCharacter(id: string): Promise<void> {
  await postJson<unknown>(buildUrl("/kazusa/character/delete"), { id });
}
