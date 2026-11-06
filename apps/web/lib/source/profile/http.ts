import {
  ProfileResponseSchema,
  type ProfileResponse,
  type ProfileSavePayload,
} from "@kazusa/client";
import { buildUrl, postJson, request } from "../http";

export const PROFILE_KEY = "kazusa/profile";

export async function fetchProfile(): Promise<ProfileResponse> {
  const data = await request<unknown>(buildUrl("/kazusa/profile"));
  return ProfileResponseSchema.parse(data);
}

export async function saveProfile(
  payload: ProfileSavePayload,
): Promise<ProfileResponse> {
  const data = await postJson<unknown>(
    buildUrl("/kazusa/profile/save"),
    payload,
  );
  return ProfileResponseSchema.parse(data);
}
