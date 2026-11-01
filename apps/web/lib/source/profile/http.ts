import {
  ProfileResponseSchema,
  type ProfileResponse,
  type ProfileSavePayload,
} from "@kazusa/client";
import { buildUrl, postJson, request } from "../http";

export const PROFILE_KEY = "kazusa/profile";

export async function fetchProfile(
  baseUrl: string,
  token?: string,
): Promise<ProfileResponse> {
  const data = await request<unknown>(
    buildUrl(baseUrl, "/kazusa/profile"),
    undefined,
    token,
  );
  return ProfileResponseSchema.parse(data);
}

export async function saveProfile(
  baseUrl: string,
  payload: ProfileSavePayload,
  token?: string,
): Promise<ProfileResponse> {
  const data = await postJson<unknown>(
    buildUrl(baseUrl, "/kazusa/profile/save"),
    payload,
    token,
  );
  return ProfileResponseSchema.parse(data);
}
