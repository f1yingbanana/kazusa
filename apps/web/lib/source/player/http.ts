import { PlayResponseSchema, type PlayResponse } from "@kazusa/client";
import { buildUrl, postJson } from "../http";

/** Play a character, or nobody (`null`) to watch. */
export async function playAs(
  characterId: string | null,
): Promise<PlayResponse> {
  const data = await postJson<unknown>(buildUrl("/kazusa/player"), {
    characterId,
  });
  return PlayResponseSchema.parse(data);
}
