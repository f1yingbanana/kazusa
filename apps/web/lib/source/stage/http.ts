import { StageResponseSchema, type StageResponse } from "@kazusa/client";
import { buildUrl, postJson } from "../http";

/** Sends characters off or brings them back, a whole group in one request. */
export async function setStage(
  ids: readonly string[],
  onstage: boolean,
): Promise<StageResponse> {
  const data = await postJson<unknown>(buildUrl("/kazusa/character/stage"), {
    ids,
    onstage,
  });
  return StageResponseSchema.parse(data);
}
