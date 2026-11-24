import {
  BridgesResponseSchema,
  type BridgeLinkPayload,
  type BridgesResponse,
  type BridgeTokenPayload,
} from "@kazusa/client";
import { buildUrl, postJson, request } from "../http";

export const BRIDGES_KEY = "kazusa:bridges";

/** The Discord connection and which groups are linked; owner only. */
export async function fetchBridges(): Promise<BridgesResponse> {
  return BridgesResponseSchema.parse(
    await request<unknown>(buildUrl("/kazusa/bridges")),
  );
}

/** Saves the bot's token, or removes it, and connects again. */
export async function saveBridgeToken(
  payload: BridgeTokenPayload,
): Promise<BridgesResponse> {
  return BridgesResponseSchema.parse(
    await postJson<unknown>(buildUrl("/kazusa/bridges/token"), payload),
  );
}

/** Links a group to a Discord channel, or unlinks it. */
export async function linkBridge(
  payload: BridgeLinkPayload,
): Promise<BridgesResponse> {
  return BridgesResponseSchema.parse(
    await postJson<unknown>(buildUrl("/kazusa/bridges/link"), payload),
  );
}
