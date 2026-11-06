"use client";

import useSWR from "swr";
import {
  AccessSchema,
  accessForRole,
  hasPermission as checkPermission,
  type Access,
  type Permission,
  type Role,
} from "@kazusa/client";
import { buildUrl, request } from "@/lib/source/http";

export const ACCESS_KEY = "kazusa/access";

export const FALLBACK_ACCESS: Access = accessForRole("visitor");

export async function fetchAccess(): Promise<Access> {
  const raw = await request<unknown>(buildUrl("/kazusa/access"));
  return AccessSchema.parse(raw);
}

export type AccessState = Omit<UseAccessResult, "mutate">;

export function computeAccessState(
  data: Access | undefined,
  isLoading: boolean,
  error: Error | undefined,
): AccessState {
  // Fail closed only until access is first known, then keep the last good answer.
  const hasKnownAccess = Boolean(data);
  const safeAccess = data ?? FALLBACK_ACCESS;
  const canPlay = hasKnownAccess
    ? checkPermission(safeAccess.role, "play")
    : false;
  const canManage = hasKnownAccess
    ? checkPermission(safeAccess.role, "manage")
    : false;
  const isOwner = hasKnownAccess && safeAccess.role === "owner";
  const isLocal = hasKnownAccess ? Boolean(safeAccess.local) : false;
  // Visitors cannot play, so they are read-only. Collaborators can play, so they are not view-only.
  const isReadOnly = hasKnownAccess ? !canPlay : true;

  const hasPerm = (permission: Permission): boolean => {
    if (!hasKnownAccess) {
      return permission === "observe";
    }
    return checkPermission(safeAccess.role, permission);
  };

  return {
    access: safeAccess,
    role: safeAccess.role,
    permissions: safeAccess.permissions,
    isLoading,
    error,
    canPlay,
    canManage,
    isReadOnly,
    isOwner,
    isLocal,
    hasPermission: hasPerm,
  };
}

export interface UseAccessResult {
  readonly access: Access;
  readonly role: Role;
  readonly permissions: readonly Permission[];
  readonly isLoading: boolean;
  readonly error?: Error;
  readonly canPlay: boolean;
  readonly canManage: boolean;
  readonly isReadOnly: boolean;
  readonly isOwner: boolean;
  readonly isLocal: boolean;
  readonly hasPermission: (permission: Permission) => boolean;
  readonly mutate: () => Promise<Access | undefined>;
}

export function useAccess(): UseAccessResult {
  const { data, error, isLoading, mutate } = useSWR<Access, Error>(
    ACCESS_KEY,
    fetchAccess,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: true,
    },
  );

  const state = computeAccessState(data, isLoading, error);
  return {
    ...state,
    mutate,
  };
}
