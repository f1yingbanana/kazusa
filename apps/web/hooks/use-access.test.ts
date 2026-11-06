import { describe, expect, it } from "vitest";
import { AccessSchema, accessForRole } from "@kazusa/client";
import { computeAccessState } from "./use-access";

describe("computeAccessState", () => {
  it("fails closed while loading, disabling mutations before server answers", () => {
    const state = computeAccessState(undefined, true, undefined);
    expect(state.isLoading).toBe(true);
    expect(state.role).toBe("visitor");
    expect(state.isReadOnly).toBe(true);
    expect(state.canPlay).toBe(false);
    expect(state.canManage).toBe(false);
    expect(state.isOwner).toBe(false);
    expect(state.hasPermission("observe")).toBe(true);
    expect(state.hasPermission("play")).toBe(false);
    expect(state.hasPermission("manage")).toBe(false);
  });

  it("fails closed on initial network or server error", () => {
    const error = new Error("Failed to fetch /kazusa/access");
    const state = computeAccessState(undefined, false, error);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBe(error);
    expect(state.role).toBe("visitor");
    expect(state.isReadOnly).toBe(true);
    expect(state.canPlay).toBe(false);
    expect(state.canManage).toBe(false);
    expect(state.isOwner).toBe(false);
    expect(state.hasPermission("observe")).toBe(true);
    expect(state.hasPermission("play")).toBe(false);
    expect(state.hasPermission("manage")).toBe(false);
  });

  it("retains known owner access when a background revalidation fails", () => {
    const ownerAccess = accessForRole("owner");
    const revalidationError = new Error("Temporary gateway disconnect");
    const state = computeAccessState(ownerAccess, false, revalidationError);
    expect(state.error).toBe(revalidationError);
    expect(state.role).toBe("owner");
    expect(state.isReadOnly).toBe(false);
    expect(state.canPlay).toBe(true);
    expect(state.canManage).toBe(true);
    expect(state.isOwner).toBe(true);
    expect(state.hasPermission("manage")).toBe(true);
  });

  it("treats visitor role as read-only with observe-only permissions", () => {
    const access = accessForRole("visitor");
    const state = computeAccessState(access, false, undefined);
    expect(state.role).toBe("visitor");
    expect(state.isReadOnly).toBe(true);
    expect(state.canPlay).toBe(false);
    expect(state.canManage).toBe(false);
    expect(state.isOwner).toBe(false);
    expect(state.hasPermission("observe")).toBe(true);
    expect(state.hasPermission("play")).toBe(false);
    expect(state.hasPermission("manage")).toBe(false);
  });

  it("grants play to collaborators without marking view-only", () => {
    const access = accessForRole("collaborator");
    const state = computeAccessState(access, false, undefined);
    expect(state.role).toBe("collaborator");
    expect(state.canPlay).toBe(true);
    expect(state.canManage).toBe(false);
    expect(state.isReadOnly).toBe(false);
    expect(state.isOwner).toBe(false);
    expect(state.hasPermission("observe")).toBe(true);
    expect(state.hasPermission("play")).toBe(true);
    expect(state.hasPermission("manage")).toBe(false);
  });

  it("grants all permissions to local owner", () => {
    const access = accessForRole("owner");
    const state = computeAccessState(access, false, undefined);
    expect(state.role).toBe("owner");
    expect(state.canPlay).toBe(true);
    expect(state.canManage).toBe(true);
    expect(state.isReadOnly).toBe(false);
    expect(state.isOwner).toBe(true);
    expect(state.hasPermission("observe")).toBe(true);
    expect(state.hasPermission("play")).toBe(true);
    expect(state.hasPermission("manage")).toBe(true);
  });

  it("validates role and permissions rejecting malformed payloads", () => {
    expect(() => AccessSchema.parse({ role: "admin" })).toThrow();
    expect(() => AccessSchema.parse({})).toThrow();
    expect(() => AccessSchema.parse(null)).toThrow();
    expect(() =>
      AccessSchema.parse({
        role: "owner",
        permissions: ["observe", "play", "manage"],
      }),
    ).not.toThrow();
  });

  it("distinguishes local owner from remote/cloud owner", () => {
    const localOwner = accessForRole("owner", { local: true });
    expect(computeAccessState(localOwner, false, undefined).isLocal).toBe(true);

    const cloudOwner = accessForRole("owner", { local: false });
    expect(computeAccessState(cloudOwner, false, undefined).isLocal).toBe(
      false,
    );

    const cloudVisitor = accessForRole("visitor", { local: false });
    expect(computeAccessState(cloudVisitor, false, undefined).isLocal).toBe(
      false,
    );
  });
});
