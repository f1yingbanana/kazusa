import {
  BoxesIcon,
  ChartColumnIcon,
  CircleArrowUpIcon,
  HistoryIcon,
  MessagesSquareIcon,
  PlugIcon,
  SlidersHorizontalIcon,
  UserIcon,
} from "lucide-react";
import { ConnectionSettings } from "@/components/views/settings/connection-settings";
import { ContextSettings } from "@/components/views/settings/context-settings";
import { ChatAppsSettings } from "@/components/views/settings/chat-apps-settings";
import { ModelSettings } from "@/components/views/settings/model-settings";
import { ProfileSettings } from "@/components/views/settings/profile-settings";
import { StateSettings } from "@/components/views/settings/state-settings";
import { UpdateSettings } from "@/components/views/settings/update-settings";
import { UsageSettings } from "@/components/views/settings/usage-settings";
import type { SettingsCategory } from "./types";

const CATEGORIES: readonly SettingsCategory[] = [
  {
    id: "connection",
    label: "Connection",
    description: "Server status",
    icon: PlugIcon,
    order: 0,
    component: ConnectionSettings,
  },
  {
    id: "profile",
    label: "Profile",
    description: "Who you are to the system agent",
    icon: UserIcon,
    order: 5,
    requiresPermission: "manage",
    component: ProfileSettings,
  },
  {
    id: "models",
    label: "Models",
    description: "AI models that power the simulation",
    icon: BoxesIcon,
    order: 10,
    requiresPermission: "manage",
    component: ModelSettings,
  },
  {
    id: "context",
    label: "Context",
    description: "Character memory and token usage",
    icon: HistoryIcon,
    order: 15,
    requiresPermission: "manage",
    component: ContextSettings,
  },
  {
    id: "states",
    label: "States",
    description: "Variables on characters and the world",
    icon: SlidersHorizontalIcon,
    order: 17,
    requiresPermission: "manage",
    component: StateSettings,
  },
  {
    id: "chat-apps",
    label: "Chat apps",
    description: "Chat directly in connected apps",
    icon: MessagesSquareIcon,
    order: 18,
    requiresPermission: "play",
    component: ChatAppsSettings,
  },
  {
    id: "usage",
    label: "Usage",
    description: "Tokens used, in total and by character",
    icon: ChartColumnIcon,
    order: 20,
    requiresPermission: "manage",
    component: UsageSettings,
  },
  {
    id: "updates",
    label: "Updates",
    description: "System and world updates",
    icon: CircleArrowUpIcon,
    order: 30,
    requiresPermission: "manage",
    requiresMaintain: true,
    component: UpdateSettings,
  },
];

/** Settings pages, listed in the Settings sidebar; `settings.tab` picks one. */
export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  ...CATEGORIES,
].sort((a, b) => a.order - b.order);

export const DEFAULT_SETTINGS_CATEGORY = "connection";
