"use client";

import {
  DrawerBackdrop,
  DrawerContent,
  DrawerHandle,
  DrawerTitle,
} from "@ui-sdk/react/drawer";
import type { ReactNode } from "react";
import { BACKDROP } from "./overlay";

export { Drawer } from "@ui-sdk/react/drawer";

/**
 * The drawer's sheet with its backdrop. `handle` names a drag grip, for a
 * drawer from the bottom.
 */
export function DrawerPanel({
  title,
  handle,
  children,
}: {
  title: string;
  handle?: string;
  children: ReactNode;
}) {
  return (
    <>
      <DrawerBackdrop className={BACKDROP} />
      <DrawerContent className="fixed z-55 flex flex-col bg-ui-surface text-ui-ink shadow-ui outline-none data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-[calc(100dvh-3rem)] data-[side=bottom]:rounded-t-[1.5rem] data-[side=right]:inset-y-3 data-[side=right]:right-3 data-[side=right]:w-[min(24rem,calc(100vw-1.5rem))] data-[side=right]:rounded-[1.5rem]">
        {handle ? (
          <DrawerHandle
            className="mt-2.5 h-1.5 w-12 shrink-0 self-center rounded-full bg-ui-line"
            aria-label={handle}
          />
        ) : null}
        <DrawerTitle className="sr-only">{title}</DrawerTitle>
        <div className="flex min-h-0 flex-1 flex-col *:min-h-0 *:flex-1">
          {children}
        </div>
      </DrawerContent>
    </>
  );
}
