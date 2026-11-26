"use client";

import { useQueryState } from "nuqs";
import { useAccess } from "@/hooks/use-access";
import type { SectionSidebarProps } from "../shell/sections";
import {
  ListPane,
  ListPaneScroll,
  ListRow,
  ListRows,
  ListSection,
} from "@/ui/list";
import {
  DEFAULT_SETTINGS_TAB,
  SETTINGS_GROUP_LABELS,
  SETTINGS_GROUP_ORDER,
  filterAllowedCategories,
  type SettingsCategoryItem,
} from "./categories";
import { settingsParsers, useOpenSettings } from "./search-params";

export function useAllowedSettingsCategories(): SettingsCategoryItem[] {
  const { hasPermission, canMaintain } = useAccess();
  return filterAllowedCategories(hasPermission, canMaintain);
}

export function useActiveSettingsCategory(): SettingsCategoryItem {
  const [tab] = useQueryState("settings.tab", settingsParsers["settings.tab"]);
  const allowed = useAllowedSettingsCategories();
  return (
    allowed.find((item) => item.id === tab) ??
    allowed.find((item) => item.id === DEFAULT_SETTINGS_TAB) ??
    allowed[0]
  );
}

export function SettingsSidebar({ onNavigated }: SectionSidebarProps) {
  const openSettings = useOpenSettings();
  const allowed = useAllowedSettingsCategories();
  const active = useActiveSettingsCategory();

  return (
    <ListPane>
      <ListPaneScroll>
        {SETTINGS_GROUP_ORDER.map((group) => {
          const items = allowed.filter((item) => item.group === group);
          if (items.length === 0) return null;
          return (
            <ListSection key={group} title={SETTINGS_GROUP_LABELS[group]}>
              <ListRows>
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.id}>
                      <ListRow
                        current={item.id === active?.id}
                        leading={
                          <span
                            aria-hidden
                            className="grid size-8 shrink-0 place-items-center rounded-[0.75rem] bg-ui-tint text-ui-soft [&_svg]:size-4"
                          >
                            <Icon />
                          </span>
                        }
                        title={item.label}
                        sub={item.description}
                        onClick={() => {
                          openSettings(item.id);
                          onNavigated?.();
                        }}
                      />
                    </li>
                  );
                })}
              </ListRows>
            </ListSection>
          );
        })}
      </ListPaneScroll>
    </ListPane>
  );
}
