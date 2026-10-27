import {
  CharacterDetailResponseSchema,
  CharactersResponseSchema,
  type CharacterDetail,
  type CharacterSummary,
} from "@kazusa/client";
import { buildUrl, request } from "../http";

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
