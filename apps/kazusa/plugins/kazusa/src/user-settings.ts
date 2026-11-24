import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { z } from "zod";
import type { RemovableStateStore } from "./state.ts";

/** A platform account a person has proved is theirs. */
export const LinkedAccountSchema = z.object({
  /** The platform's id for the account (Discord's user id). */
  id: z.string().min(1),
  /** Its name there when it was linked, to show. */
  name: z.string(),
  linkedAt: z.number(),
});
export type LinkedAccount = z.infer<typeof LinkedAccountSchema>;

/**
 * One person's own settings: theirs whatever world or save is loaded, kept by
 * their id (`user:<id>`), never another person's to see or change. Only the
 * operator has one until collaborators come.
 */
export const UserSettingsSchema = z.object({
  /**
   * Their Discord account: what they write in a linked channel is said as the
   * character they play.
   */
  discord: LinkedAccountSchema.optional(),
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;

export interface UserSettingsStore {
  get(userId: string): Promise<UserSettings>;
  /** Writes one person's settings whole; an empty record is removed. */
  set(userId: string, settings: UserSettings): Promise<void>;
  /** Who linked a Discord account, if anyone did. */
  byDiscord(accountId: string): Promise<string | undefined>;
}

/**
 * The retained `"userSettings"` store, one record per person. A save's load
 * keeps it (saves' `MACHINE`): a person's settings are theirs, not a game's.
 */
export function createUserSettings(
  store: RemovableStateStore<UserSettings>,
): UserSettingsStore {
  const read = (value: unknown): UserSettings =>
    UserSettingsSchema.safeParse(value).data ?? {};
  return {
    get: async (userId) => read(await store.lookup(userId)),
    set: async (userId, settings) => {
      const parsed = UserSettingsSchema.parse(settings);
      if (Object.keys(parsed).length) await store.register(userId, parsed);
      else await store.delete(userId);
    },
    byDiscord: async (accountId) =>
      (await store.entries()).find(
        ({ value }) => read(value).discord?.id === accountId,
      )?.key,
  };
}

export function openUserSettings(api: OpenClawPluginApi): UserSettingsStore {
  return createUserSettings(
    api.runtime.state.openKeyedStore<UserSettings>({
      namespace: "userSettings",
      retention: "retained",
    }),
  );
}
