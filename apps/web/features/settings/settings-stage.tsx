"use client";

import { useActiveSettingsCategory } from "./settings-sidebar";

export function SettingsStage() {
  const category = useActiveSettingsCategory();
  if (!category) return null;
  const Page = category.component;
  return <Page key={category.id} />;
}
