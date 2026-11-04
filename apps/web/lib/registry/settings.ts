import {
  BoxesIcon,
  ChartColumnIcon,
  CircleArrowUpIcon,
  PlugIcon,
  UserIcon,
} from "lucide-react";
import { ConnectionSettings } from "@/components/views/settings/connection-settings";
import { ModelSettings } from "@/components/views/settings/model-settings";
import { ProfileSettings } from "@/components/views/settings/profile-settings";
import { UpdateSettings } from "@/components/views/settings/update-settings";
import { UsageSettings } from "@/components/views/settings/usage-settings";
import type { SettingsCategory } from "./types";

/** Settings pages, listed in the Settings sidebar; `settings.tab` picks one. */
export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  {
    id: "connection",
    label: "Connection",
    description: "Server and token",
    icon: PlugIcon,
    order: 0,
    component: ConnectionSettings,
  },
  {
    id: "profile",
    label: "Profile",
    description: "Your description in the World Wiki",
    icon: UserIcon,
    order: 5,
    component: ProfileSettings,
  },
  {
    id: "models",
    label: "Models",
    description: "Chat, decision and memory search models",
    icon: BoxesIcon,
    order: 10,
    component: ModelSettings,
  },
  {
    id: "usage",
    label: "Usage",
    description: "Tokens used, in total and by character",
    icon: ChartColumnIcon,
    order: 20,
    component: UsageSettings,
  },
  {
    id: "updates",
    label: "Updates",
    description: "This version, and updating it",
    icon: CircleArrowUpIcon,
    order: 30,
    component: UpdateSettings,
  },
].sort((a, b) => a.order - b.order);

export const DEFAULT_SETTINGS_CATEGORY = "connection";
