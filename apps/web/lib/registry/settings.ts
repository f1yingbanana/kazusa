import { BoxesIcon, ChartColumnIcon, PlugIcon } from "lucide-react";
import { ConnectionSettings } from "@/components/views/settings/connection-settings";
import { ModelSettings } from "@/components/views/settings/model-settings";
import { UsageSettings } from "@/components/views/settings/usage-settings";
import type { SettingsCategory } from "./types";

/** Settings pages, listed in the Settings sidebar; `settings.tab` picks one. */
export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  {
    id: "connection",
    label: "Connection",
    description: "Server, token and mock data",
    icon: PlugIcon,
    order: 0,
    component: ConnectionSettings,
  },
  {
    id: "models",
    label: "Models",
    description: "Default chat model and reasoning",
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
].sort((a, b) => a.order - b.order);

export const DEFAULT_SETTINGS_CATEGORY = "connection";
