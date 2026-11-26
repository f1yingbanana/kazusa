"use client";

import type { WikiGroup, WikiLevel, WikiMember } from "@kazusa/client";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Layer } from "@/lib/wiki/layers";
import { IconButton } from "@/ui/button";
import { cx } from "@/ui/cx";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/ui/select";
import { Layered, LAYER_NAME } from "./article";
import { AddPicker, type PickOption } from "@/ui/combobox";

/** One part of the form: its name, a line on what it does, then its fields. */
export function EditorSection({
  title,
  hint,
  className,
  children,
}: {
  title: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cx(
        "flex flex-col gap-3 border-t border-ui-line pt-5",
        className,
      )}
    >
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[0.9375rem] font-extrabold">{title}</h2>
        {hint ? (
          <p className="text-[0.8125rem] leading-normal text-pretty text-ui-soft">
            {hint}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * A text field for one layer of a page, on the same rail the page reads with:
 * its name, who reads it, and under the field what goes in it.
 */
export function LayerField({
  layer,
  htmlFor,
  name,
  readers,
  hint,
  children,
}: {
  layer: Layer;
  htmlFor: string;
  /** The field's own name, when it isn't the layer's. */
  name?: string;
  readers?: string | undefined;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Layered layer={layer}>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <label htmlFor={htmlFor} className="text-sm font-bold">
            {name ?? LAYER_NAME[layer]}
          </label>
          {readers ? (
            <span className="text-xs font-semibold text-ui-soft">
              {readers}
            </span>
          ) : null}
        </div>
        {children}
        {hint ? (
          <p className="text-xs leading-normal text-ui-soft">{hint}</p>
        ) : null}
      </div>
    </Layered>
  );
}

export interface LevelChoice {
  readonly value: WikiLevel;
  readonly label: string;
}

/** How well a group knows a page, as its choice reads. */
export const knowingLevels = (person: boolean): readonly LevelChoice[] => {
  const them = person ? "them" : "it";
  return [
    { value: "heard of", label: `Heard of ${them}` },
    { value: "knows", label: `Know ${them}` },
    { value: "close", label: `Know ${them} well` },
  ];
};

/** How involved someone is in a group, and so what they get through it. */
export const MEMBER_LEVELS: readonly LevelChoice[] = [
  { value: "heard of", label: "Associate" },
  { value: "knows", label: "Member" },
  { value: "close", label: "Close member" },
];

function LevelSelect({
  label,
  levels,
  value,
  onChange,
}: {
  label: string;
  levels: readonly LevelChoice[];
  value: WikiLevel;
  onChange: (level: WikiLevel) => void;
}) {
  return (
    <Select<WikiLevel>
      items={[...levels]}
      value={value}
      onValueChange={(next) => next && onChange(next)}
    >
      <SelectTrigger aria-label={label} className="h-9 w-40 max-sm:w-full" />
      <SelectContent align="end">
        {levels.map((level) => (
          <SelectItem key={level.value} value={level.value}>
            {level.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Rows of who, each with a level and a way out, and a field to add one more:
 * the groups that know a page, the groups someone is in, the members of a
 * group. Whatever is added comes in at the middle level.
 */
export function LevelRows<T extends { readonly level: WikiLevel }>({
  rows,
  keyOf,
  nameOf,
  levels,
  levelLabel,
  onChange,
  add,
  empty,
}: {
  rows: readonly T[];
  keyOf: (row: T) => string;
  nameOf: (row: T) => string;
  levels: readonly LevelChoice[];
  levelLabel: (row: T) => string;
  onChange: (rows: T[]) => void;
  add: {
    label: string;
    placeholder: string;
    options: readonly PickOption[];
    onAdd: (value: string) => void;
    onCreate?: (name: string) => Promise<void>;
  };
  empty?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {rows.length ? (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row, index) => (
            <li
              key={keyOf(row)}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-[0.875rem] bg-ui-ground py-1 ps-3.5 pe-1 motion-safe:animate-ui-rise max-sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <span className="min-w-0 truncate text-sm font-bold">
                {nameOf(row)}
              </span>
              <span className="max-sm:order-3 max-sm:col-span-2 max-sm:pb-1">
                <LevelSelect
                  label={levelLabel(row)}
                  levels={levels}
                  value={row.level}
                  onChange={(level) =>
                    onChange(
                      rows.map((one, at) =>
                        at === index ? { ...one, level } : one,
                      ),
                    )
                  }
                />
              </span>
              <IconButton
                label={`Take out ${nameOf(row)}`}
                size="sm"
                onClick={() => onChange(rows.filter((_, at) => at !== index))}
              >
                <XIcon aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : empty ? (
        <p className="text-[0.8125rem] text-ui-soft">{empty}</p>
      ) : null}
      <AddPicker {...add} createLabel={(query) => `New group “${query}”`} />
    </div>
  );
}

export type { WikiGroup, WikiMember };
