"use client";

import { parseAsString, useQueryStates } from "nuqs";

export const settingsParsers = { "settings.tab": parseAsString };

export function useOpenSettings() {
  const [, setParams] = useQueryStates({
    view: parseAsString,
    "settings.tab": settingsParsers["settings.tab"],
  });
  return (tab?: string) =>
    void setParams({ view: "settings", "settings.tab": tab ?? null });
}
