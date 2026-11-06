import { describe, expect, it } from "vitest";
import { hasPermission } from "@kazusa/client";
import { INSPECTOR_SECTIONS } from "./inspector";
import { SETTINGS_CATEGORIES } from "./settings";
import { STATUS_ITEMS } from "./status";
import { STAGE_VIEWS } from "./views";

describe("registry permissions", () => {
  it("protects administrative and player settings categories from visitors", () => {
    const visitorTabs = SETTINGS_CATEGORIES.filter(
      (cat) =>
        !cat.requiresPermission ||
        hasPermission("visitor", cat.requiresPermission),
    ).map((cat) => cat.id);

    expect(visitorTabs).toContain("connection");
    expect(visitorTabs).not.toContain("models");
    expect(visitorTabs).not.toContain("context");
    expect(visitorTabs).not.toContain("usage");
    expect(visitorTabs).not.toContain("updates");
    expect(visitorTabs).not.toContain("profile");

    const ownerTabs = SETTINGS_CATEGORIES.filter(
      (cat) =>
        !cat.requiresPermission ||
        hasPermission("owner", cat.requiresPermission),
    ).map((cat) => cat.id);

    expect(ownerTabs).toContain("connection");
    expect(ownerTabs).toContain("models");
    expect(ownerTabs).toContain("context");
    expect(ownerTabs).toContain("usage");
    expect(ownerTabs).toContain("updates");
    expect(ownerTabs).toContain("profile");
  });

  it("gates model and context inspector sections for characters", () => {
    const modelSection = INSPECTOR_SECTIONS.find(
      (s) => s.id === "character.model",
    );
    const contextSection = INSPECTOR_SECTIONS.find(
      (s) => s.id === "character.context",
    );

    expect(modelSection?.requiresPermission).toBe("manage");
    expect(contextSection?.requiresPermission).toBe("manage");

    const visitorSections = INSPECTOR_SECTIONS.filter(
      (s) =>
        !s.requiresPermission || hasPermission("visitor", s.requiresPermission),
    ).map((s) => s.id);

    expect(visitorSections).not.toContain("character.model");
    expect(visitorSections).not.toContain("character.context");
    expect(visitorSections).toContain("character.header");
    expect(visitorSections).toContain("character.profile");
  });

  it("registers read-only indicator and restricts update status item", () => {
    const readOnlyItem = STATUS_ITEMS.find((item) => item.id === "read-only");
    const updateItem = STATUS_ITEMS.find((item) => item.id === "update");

    expect(readOnlyItem).toBeDefined();
    expect(readOnlyItem?.order).toBe(5);
    expect(updateItem?.requiresPermission).toBe("manage");

    const visitorStatus = STATUS_ITEMS.filter(
      (item) =>
        !item.requiresPermission ||
        hasPermission("visitor", item.requiresPermission),
    ).map((item) => item.id);

    expect(visitorStatus).toContain("read-only");
    expect(visitorStatus).not.toContain("update");
  });

  it("keeps all stage views accessible to visitors", () => {
    const visitorViews = STAGE_VIEWS.filter(
      (v) =>
        !v.requiresPermission || hasPermission("visitor", v.requiresPermission),
    ).map((v) => v.id);

    expect(visitorViews).toContain("world");
    expect(visitorViews).toContain("chats");
    expect(visitorViews).toContain("timeline");
    expect(visitorViews).toContain("wiki");
    expect(visitorViews).toContain("settings");
  });
});
