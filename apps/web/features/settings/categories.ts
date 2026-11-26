import type { Permission } from "@kazusa/client";
import {
  BoxesIcon,
  ChartColumnIcon,
  CircleArrowUpIcon,
  HistoryIcon,
  MessagesSquareIcon,
  PaletteIcon,
  PlugIcon,
  SlidersHorizontalIcon,
  UserIcon,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { AppearanceSettings } from "./appearance-settings";
import { ChatAppsSettings } from "./chat-apps-settings";
import { ConnectionSettings } from "./connection-settings";
import { ContextSettings } from "./context-settings";
import { ModelSettings } from "./model-settings";
import { ProfileSettings } from "./profile-settings";
import { StateSettings } from "./state-settings";
import { UpdateSettings } from "./update-settings";
import { UsageSettings } from "./usage-settings";

export type SettingsGroupId = "app" | "world" | "system";

export interface SettingsCategoryItem {
  readonly id: string;
  readonly group: SettingsGroupId;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly component: ComponentType;
  readonly requiresPermission?: Permission;
  readonly requiresMaintain?: boolean;
}

export const SETTINGS_GROUP_LABELS: Record<SettingsGroupId, string> = {
  app: "App",
  world: "World",
  system: "System",
};

export const SETTINGS_GROUP_ORDER: readonly SettingsGroupId[] = [
  "app",
  "world",
  "system",
];

export const SETTINGS_ITEMS: readonly SettingsCategoryItem[] = [
  {
    id: "connection",
    group: "app",
    label: "Connection",
    description: "Server status and Gateway target",
    icon: PlugIcon,
    component: ConnectionSettings,
  },
  {
    id: "appearance",
    group: "app",
    label: "Appearance",
    description: "Light/dark mode and color palette",
    icon: PaletteIcon,
    component: AppearanceSettings,
  },
  {
    id: "profile",
    group: "world",
    label: "Profile",
    description: "How the system agent knows you",
    icon: UserIcon,
    requiresPermission: "manage",
    component: ProfileSettings,
  },
  {
    id: "models",
    group: "world",
    label: "Models",
    description: "Chat, decision, and memory models",
    icon: BoxesIcon,
    requiresPermission: "manage",
    component: ModelSettings,
  },
  {
    id: "context",
    group: "world",
    label: "Context",
    description: "Memory window and prompt limits",
    icon: HistoryIcon,
    requiresPermission: "manage",
    component: ContextSettings,
  },
  {
    id: "states",
    group: "world",
    label: "States",
    description: "Variables on characters and world",
    icon: SlidersHorizontalIcon,
    requiresPermission: "manage",
    component: StateSettings,
  },
  {
    id: "chat-apps",
    group: "world",
    label: "Chat apps",
    description: "Discord bot and linked channels",
    icon: MessagesSquareIcon,
    requiresPermission: "play",
    component: ChatAppsSettings,
  },
  {
    id: "usage",
    group: "system",
    label: "Usage",
    description: "Tokens used and estimated cost",
    icon: ChartColumnIcon,
    requiresPermission: "manage",
    component: UsageSettings,
  },
  {
    id: "updates",
    group: "system",
    label: "Updates",
    description: "Kazusa and world versions",
    icon: CircleArrowUpIcon,
    requiresPermission: "manage",
    requiresMaintain: true,
    component: UpdateSettings,
  },
];

export const DEFAULT_SETTINGS_TAB = "connection";

export function filterAllowedCategories(
  hasPermission: (permission: Permission) => boolean,
  canMaintain: boolean,
): SettingsCategoryItem[] {
  return SETTINGS_ITEMS.filter(
    (item) =>
      (!item.requiresPermission || hasPermission(item.requiresPermission)) &&
      (!item.requiresMaintain || canMaintain),
  );
}
