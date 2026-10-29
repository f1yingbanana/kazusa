import { StageResponseSchema, type StageResponse } from "@kazusa/client";
import { buildUrl, postJson } from "../http";

/** Sends characters off or brings them back, a whole group in one request. */
export async function setStage(
  baseUrl: string,
  ids: readonly string[],
  onstage: boolean,
  token?: string,
): Promise<StageResponse> {
  const data = await postJson<unknown>(
    buildUrl(baseUrl, "/kazusa/character/stage"),
    { ids, onstage },
    token,
  );
  return StageResponseSchema.parse(data);
}
