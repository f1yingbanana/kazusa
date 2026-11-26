"use client";

import {
  TriggerMenu,
  TriggerMenuContent,
  TriggerMenuEmpty,
  TriggerMenuInput,
  TriggerMenuItem,
  TriggerMenuList,
  TriggerMenuStatus,
  type TriggerMenuDataItem,
} from "@ui-sdk/react/trigger-menu";
import type { ComponentProps, KeyboardEvent, ReactNode } from "react";
import { cx } from "./cx";
import { POPUP } from "./popup";
import { VisuallyHidden } from "./visually-hidden";

export interface Suggestion {
  readonly value: string;
  readonly label: string;
}

const FIELD =
  "w-full min-w-0 resize-none rounded-[0.875rem] bg-ui-ground px-3.5 py-2.5 text-[0.9375rem] leading-[1.65] text-ui-ink inset-ring inset-ring-ui-line outline-none [field-sizing:content] placeholder:text-ui-soft focus-visible:inset-ring-2 focus-visible:inset-ring-ui-primary";

/**
 * A textarea where typing `trigger` offers suggestions at the caret, and
 * choosing one writes `insert(value)` in place of what was typed. ⌘S and ⌘Enter
 * go to `onSubmit`.
 */
export function SuggestTextarea({
  value,
  onChange,
  trigger,
  suggest,
  insert,
  renderItem,
  emptyText,
  mono = false,
  minRows = 3,
  onSubmit,
  className,
  ...props
}: Omit<ComponentProps<"textarea">, "value" | "onChange" | "className"> & {
  value: string;
  onChange: (value: string) => void;
  trigger: string;
  suggest: (query: string) => readonly Suggestion[];
  insert: (value: string) => string;
  renderItem?: (item: Suggestion) => ReactNode;
  emptyText: string;
  mono?: boolean;
  minRows?: number;
  onSubmit?: () => void;
  className?: string;
}) {
  return (
    <TriggerMenu
      triggers={[
        {
          char: trigger,
          spaces: 4,
          maxLength: 60,
          items: (query: string): TriggerMenuDataItem[] => [...suggest(query)],
          insert: (item: TriggerMenuDataItem) => insert(item.value),
        },
      ]}
    >
      <TriggerMenuInput
        {...props}
        value={value}
        rows={minRows}
        spellCheck
        onChange={(event: { target: { value: string } }) =>
          onChange(event.target.value)
        }
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.nativeEvent.isComposing) return;
          if (
            onSubmit &&
            (event.metaKey || event.ctrlKey) &&
            (event.key === "s" || event.key === "Enter")
          ) {
            event.preventDefault();
            onSubmit();
          }
        }}
        className={cx(
          FIELD,
          mono &&
            "font-[ui-monospace,monospace] text-[0.8125rem] leading-relaxed",
          className,
        )}
      />
      <VisuallyHidden>
        <TriggerMenuStatus />
      </VisuallyHidden>
      <TriggerMenuContent
        sideOffset={6}
        className={cx(POPUP, "w-72 gap-0.5 rounded-[1rem] p-1")}
      >
        <TriggerMenuEmpty className="px-2.5 py-2 text-sm text-ui-soft">
          {emptyText}
        </TriggerMenuEmpty>
        <TriggerMenuList className="flex flex-col gap-0.5">
          {(state) =>
            (state.items as TriggerMenuDataItem[]).map((item) => (
              <TriggerMenuItem
                key={item.value}
                value={item.value}
                label={item.label}
                className="flex min-h-9 cursor-default items-center gap-2 rounded-[0.75rem] px-2.5 text-sm font-semibold outline-none data-highlighted:bg-ui-tint [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ui-soft"
              >
                {renderItem ? renderItem(item) : item.label}
              </TriggerMenuItem>
            ))
          }
        </TriggerMenuList>
      </TriggerMenuContent>
    </TriggerMenu>
  );
}
