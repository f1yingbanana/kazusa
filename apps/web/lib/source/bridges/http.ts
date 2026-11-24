import {
  BridgeAccountResponseSchema,
  BridgeLinkCodeResponseSchema,
  BridgesResponseSchema,
  type BridgeAccountResponse,
  type BridgeLinkCodeResponse,
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

export const BRIDGE_ACCOUNT_KEY = "kazusa:bridges:account";

/** The person's own Discord account, and the bot to link it through. */
export async function fetchBridgeAccount(): Promise<BridgeAccountResponse> {
  return BridgeAccountResponseSchema.parse(
    await request<unknown>(buildUrl("/kazusa/bridges/account")),
  );
}

/** A code to link the person's Discord account with, for ten minutes. */
export async function makeLinkCode(): Promise<BridgeLinkCodeResponse> {
  return BridgeLinkCodeResponseSchema.parse(
    await postJson<unknown>(buildUrl("/kazusa/bridges/account/code"), {}),
  );
}

/** Unlinks the person's Discord account. */
export async function unlinkAccount(): Promise<BridgeAccountResponse> {
  return BridgeAccountResponseSchema.parse(
    await postJson<unknown>(buildUrl("/kazusa/bridges/account/unlink"), {}),
  );
}
