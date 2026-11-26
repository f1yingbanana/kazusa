"use client";

import { ChevronLeftIcon, ListFilterIcon } from "lucide-react";
import { createContext, use, type ReactNode } from "react";
import { Button, IconButton } from "./button";
import { cx } from "./cx";

/**
 * How a stage shown on its own (a phone, a narrow window) gets back to the list
 * beside it: `back` returns to the list, which it replaced; `list` opens the
 * list over it, for a stage that is the place to land.
 */
export interface PaneNav {
  readonly back?: { readonly label: string; readonly go: () => void };
  readonly list?: {
    readonly label: string;
    readonly icon?: ReactNode;
    readonly open: () => void;
  };
}

const Nav = createContext<PaneNav>({});

export function PaneNavProvider({
  value,
  children,
}: {
  value: PaneNav;
  children: ReactNode;
}) {
  return <Nav value={value}>{children}</Nav>;
}

export function usePaneNav(): PaneNav {
  return use(Nav);
}

/** Back to the list, at the start of a stage's header; nothing when docked. */
export function PaneBackButton({ className }: { className?: string }) {
  const { back } = usePaneNav();
  if (!back) return null;
  return (
    <IconButton
      label={`Back to ${back.label.toLowerCase()}`}
      size="md"
      className={cx("-ms-1.5 shrink-0", className)}
      onClick={back.go}
    >
      <ChevronLeftIcon aria-hidden />
    </IconButton>
  );
}

/** Opens the list over the stage, in a stage's header; nothing when docked. */
export function PaneListButton({ className }: { className?: string }) {
  const { list } = usePaneNav();
  if (!list) return null;
  return (
    <Button
      tone="soft"
      size="sm"
      icon={list.icon ?? <ListFilterIcon aria-hidden />}
      className={className}
      onClick={list.open}
    >
      {list.label}
    </Button>
  );
}
