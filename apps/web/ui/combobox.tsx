"use client";

import {
  Combobox,
  ComboboxClear,
  ComboboxContent,
  ComboboxCreate,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@ui-sdk/react/combobox";
import { LoaderCircleIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { cx } from "./cx";
import { POPUP } from "./popup";

export {
  Combobox,
  ComboboxInput,
  ComboboxTrigger,
} from "@ui-sdk/react/combobox";

export interface PickOption {
  readonly value: string;
  readonly label: string;
  /** A second line, like the areas a place is in. */
  readonly hint?: string | undefined;
  readonly media?: ReactNode;
}

const INPUT =
  "h-9 w-full min-w-0 rounded-[0.875rem] bg-ui-ground px-3.5 text-sm text-ui-ink inset-ring inset-ring-ui-line outline-none placeholder:text-ui-soft focus-visible:inset-ring-2 focus-visible:inset-ring-ui-primary data-[disabled]:opacity-60";

export const COMBOBOX_LIST = cx(
  POPUP,
  "max-h-[min(20rem,var(--available-height))] w-(--anchor-width) min-w-60 gap-0.5 overflow-y-auto rounded-[1rem] p-1",
);

export const COMBOBOX_ITEM =
  "flex min-h-9 cursor-default items-center gap-2.5 rounded-[0.75rem] px-2.5 py-1 text-sm font-semibold outline-none data-highlighted:bg-ui-tint data-[pending]:opacity-60";

function OptionRow({ option }: { option: PickOption }) {
  return (
    <>
      {option.media}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{option.label}</span>
        {option.hint ? (
          <span className="truncate text-xs font-medium text-ui-soft">
            {option.hint}
          </span>
        ) : null}
      </span>
    </>
  );
}

/**
 * A few at a time: a world has hundreds of places, and a list that long helps
 * no one.
 */
const filterTop =
  (limit: number) =>
  (options: readonly PickOption[], query: string): PickOption[] => {
    const needle = query.trim().toLowerCase();
    return options
      .filter(
        (option) =>
          !needle ||
          option.label.toLowerCase().includes(needle) ||
          option.value.includes(needle) ||
          option.hint?.toLowerCase().includes(needle),
      )
      .sort(
        (a, b) =>
          Number(b.label.toLowerCase().startsWith(needle)) -
          Number(a.label.toLowerCase().startsWith(needle)),
      )
      .slice(0, limit);
  };

/**
 * A field that adds one thing to a list: type to find it, choose it, and the
 * field empties for the next. With `onCreate`, a name no option has can be made
 * into a new one.
 */
export function AddPicker({
  label,
  placeholder,
  options,
  onAdd,
  onCreate,
  createLabel = (query) => `New “${query}”`,
  className,
}: {
  label: string;
  placeholder: string;
  options: readonly PickOption[];
  onAdd: (value: string) => void;
  onCreate?: ((name: string) => Promise<void>) | undefined;
  createLabel?: (query: string) => string;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const shown = filterTop(30)(options, query);
  return (
    <Combobox<string>
      value={null}
      query={query}
      onQueryChange={(next, details) => {
        if (details.reason !== "item-press") setQuery(next);
      }}
      onValueChange={(next) => {
        if (next === null) return;
        onAdd(next);
        setQuery("");
      }}
      filter={false}
      autoHighlight
    >
      <div className={cx("relative max-w-72", className)}>
        <PlusIcon
          aria-hidden
          className="pointer-events-none absolute inset-s-3 top-1/2 size-4 -translate-y-1/2 text-ui-soft"
        />
        <ComboboxInput
          aria-label={label}
          placeholder={placeholder}
          className={cx(INPUT, "ps-9")}
        />
      </div>
      <ComboboxContent sideOffset={6} className={COMBOBOX_LIST}>
        <ComboboxEmpty className="px-2.5 py-2 text-sm text-ui-soft not-data-empty:hidden">
          {onCreate ? "Nothing by that name yet." : "Nothing by that name."}
        </ComboboxEmpty>
        <ComboboxList className="flex flex-col gap-0.5">
          {shown.map((option) => (
            <ComboboxItem
              key={option.value}
              value={option.value}
              label={option.label}
              className={COMBOBOX_ITEM}
            >
              <OptionRow option={option} />
            </ComboboxItem>
          ))}
          {onCreate ? (
            <ComboboxCreate
              minLength={2}
              className={COMBOBOX_ITEM}
              onCreate={async (name: string) => {
                await onCreate(name.trim());
                setQuery("");
              }}
            >
              {(state: {
                pending: boolean;
                query: string;
                error?: unknown;
              }) => (
                <>
                  {state.pending ? (
                    <LoaderCircleIcon
                      aria-hidden
                      className="size-4 motion-safe:animate-ui-spin"
                    />
                  ) : (
                    <PlusIcon aria-hidden className="size-4 text-ui-primary" />
                  )}
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">
                      {createLabel(state.query.trim())}
                    </span>
                    {state.error instanceof Error ? (
                      <span className="text-xs text-ui-danger">
                        {state.error.message}
                      </span>
                    ) : null}
                  </span>
                </>
              )}
            </ComboboxCreate>
          ) : null}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

/** One choice from many, found by typing, or none: a place's area, a home. */
export function OnePicker({
  label,
  placeholder,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  placeholder: string;
  options: readonly PickOption[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  className?: string;
}) {
  const chosen = options.find((option) => option.value === value);
  const [query, setQuery] = useState(chosen?.label ?? value ?? "");
  const [typing, setTyping] = useState(false);
  const shown = filterTop(30)(options, typing ? query : "");
  return (
    <Combobox<string>
      value={value ?? null}
      query={query}
      onQueryChange={(next, details) => {
        setQuery(next);
        setTyping(details.reason === "input-change");
      }}
      onValueChange={(next) => {
        onChange(next ?? undefined);
        setTyping(false);
      }}
      onOpenChange={(open) => {
        if (!open) {
          setTyping(false);
          setQuery(
            options.find((o) => o.value === value)?.label ?? value ?? "",
          );
        }
      }}
      itemToLabel={(next) =>
        options.find((o) => o.value === next)?.label ?? next
      }
      filter={false}
      autoHighlight
    >
      <div className={cx("relative max-w-80", className)}>
        <ComboboxInput
          aria-label={label}
          placeholder={placeholder}
          className={cx(INPUT, value && "pe-9")}
        />
        <ComboboxClear
          aria-label={`Clear ${label.toLowerCase()}`}
          className="absolute inset-e-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-ui-soft hover:bg-ui-tint hover:text-ui-ink [&_svg]:size-3.5"
        >
          <XIcon aria-hidden />
        </ComboboxClear>
      </div>
      <ComboboxContent sideOffset={6} className={COMBOBOX_LIST}>
        <ComboboxEmpty className="px-2.5 py-2 text-sm text-ui-soft not-data-empty:hidden">
          Nothing by that name.
        </ComboboxEmpty>
        <ComboboxList className="flex flex-col gap-0.5">
          {shown.map((option) => (
            <ComboboxItem
              key={option.value}
              value={option.value}
              label={option.label}
              className={COMBOBOX_ITEM}
            >
              <OptionRow option={option} />
            </ComboboxItem>
          ))}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

/** The list a combobox opens, in our look, for one laid out by hand. */
export function ComboboxPopup({
  className,
  emptyText,
  search,
  children,
  ...props
}: Omit<ComponentProps<typeof ComboboxContent>, "className" | "children"> & {
  className?: string;
  emptyText: string;
  /** A search field at the top, for a combobox opened by a button. */
  search?: string;
  children: ComponentProps<typeof ComboboxList>["children"];
}) {
  return (
    <ComboboxContent
      sideOffset={6}
      {...props}
      className={cx(COMBOBOX_LIST, className)}
    >
      {search ? (
        <div className="sticky top-0 z-1 -mx-1 -mt-1 mb-1 border-b border-ui-line bg-ui-surface p-1">
          <div className="relative">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute inset-s-3 top-1/2 size-4 -translate-y-1/2 text-ui-soft"
            />
            <ComboboxInput
              autoFocus
              aria-label={search}
              placeholder={search}
              className={cx(INPUT, "ps-9 inset-ring-0 bg-transparent")}
            />
          </div>
        </div>
      ) : null}
      <ComboboxEmpty className="px-2.5 py-2 text-sm text-ui-soft not-data-empty:hidden">
        {emptyText}
      </ComboboxEmpty>
      <ComboboxList className="flex flex-col gap-0.5">{children}</ComboboxList>
    </ComboboxContent>
  );
}

export function ComboboxOption({
  className,
  ...props
}: Omit<ComponentProps<typeof ComboboxItem>, "className"> & {
  className?: string;
}) {
  return <ComboboxItem {...props} className={cx(COMBOBOX_ITEM, className)} />;
}
