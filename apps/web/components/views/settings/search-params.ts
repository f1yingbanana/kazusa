import { parseAsString } from "nuqs/server";

// Category IDs are extensible through the settings registry.
export const settingsParsers = { "settings.tab": parseAsString };
