"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { TextButton } from "./button";
import { cx } from "./cx";
import { Drawer, DrawerPanel } from "./drawer";
import {
  Menu,
  MenuContent,
  MenuContextTrigger,
  MenuItem,
  MenuSeparator,
} from "./menu";
import { useCoarsePointer } from "./pointer";

const LONG_PRESS_MS = 450;
const PRESS_SLOP_PX = 8;

export interface ContextAction {
  readonly key: string;
  /** Actions of one group sit together, a line between groups. */
  readonly group?: number;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly run: () => void;
}

export interface ContextMenuTarget {
  readonly title?: string | undefined;
  readonly actions: readonly ContextAction[];
}

/**
 * Context actions for a region: right-click or Shift+F10 opens a compact menu
 * on desktop, and a press-and-hold opens a bottom sheet on touch screens. Pass
 * `resolve` to map the pressed element inside a list or tree to its actions, or
 * `actions` directly for a single surface.
 */
export function ContextMenu({
  resolve,
  title,
  label,
  actions,
  className,
  innerClassName,
  children,
}: {
  resolve?: (target: EventTarget | null) => ContextMenuTarget | undefined;
  title?: string | undefined;
  label?: string | undefined;
  actions?: readonly ContextAction[] | undefined;
  className?: string;
  /** For the element right around `children`, when they need a layout kept. */
  innerClassName?: string;
  children?: ReactNode;
}) {
  const touch = useCoarsePointer();
  const [current, setCurrent] = useState<ContextMenuTarget>();
  const [sheet, setSheet] = useState(false);
  const held = useRef<{ from: { x: number; y: number }; timer: number }>(
    undefined,
  );
  const swallow = useRef(false);
  const swallowReset = useRef<number>(undefined);
  const lastPointer = useRef("");

  const clearHold = () => {
    if (held.current) window.clearTimeout(held.current.timer);
    held.current = undefined;
  };

  useEffect(
    () => () => {
      clearHold();
      if (swallowReset.current) window.clearTimeout(swallowReset.current);
    },
    [],
  );

  const resolveTarget = (
    target: EventTarget | null,
  ): ContextMenuTarget | undefined => {
    if (resolve) return resolve(target);
    return actions?.length ? { title, actions } : undefined;
  };

  const resetSwallowSoon = () => {
    if (!swallow.current) return;
    if (swallowReset.current) window.clearTimeout(swallowReset.current);
    swallowReset.current = window.setTimeout(() => {
      swallow.current = false;
      swallowReset.current = undefined;
    }, 400);
  };

  const items = current?.actions ?? [];

  return (
    <div
      className={cx(
        "[-webkit-touch-callout:none] [&_a]:[-webkit-touch-callout:none]",
        touch && "select-none",
        className,
      )}
      onPointerDownCapture={(event) => {
        if (swallow.current) {
          swallow.current = false;
          if (swallowReset.current) window.clearTimeout(swallowReset.current);
          swallowReset.current = undefined;
        }
        lastPointer.current = event.pointerType;
        if (event.pointerType !== "touch") return;
        const hit = resolveTarget(event.target);
        if (!hit?.actions.length) return;
        clearHold();
        const from = { x: event.clientX, y: event.clientY };
        held.current = {
          from,
          timer: window.setTimeout(() => {
            held.current = undefined;
            swallow.current = true;
            navigator.vibrate?.(8);
            setCurrent(hit);
            setSheet(true);
          }, LONG_PRESS_MS),
        };
      }}
      onPointerMoveCapture={(event) => {
        const hold = held.current;
        if (
          hold &&
          Math.hypot(event.clientX - hold.from.x, event.clientY - hold.from.y) >
            PRESS_SLOP_PX
        )
          clearHold();
      }}
      onPointerUpCapture={() => {
        clearHold();
        resetSwallowSoon();
      }}
      onPointerCancelCapture={() => {
        clearHold();
        resetSwallowSoon();
      }}
      onDragStartCapture={(event) => {
        if (lastPointer.current === "touch") event.preventDefault();
      }}
      onClickCapture={(event) => {
        if (!swallow.current) return;
        swallow.current = false;
        if (swallowReset.current) window.clearTimeout(swallowReset.current);
        swallowReset.current = undefined;
        event.preventDefault();
        event.stopPropagation();
      }}
      onContextMenuCapture={(event) => {
        const pointerType =
          (event.nativeEvent as PointerEvent).pointerType ??
          lastPointer.current;
        if (touch || pointerType === "touch") {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const hit = resolveTarget(event.target);
        if (!hit?.actions.length) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        setCurrent(hit);
      }}
    >
      <Menu>
        <MenuContextTrigger
          render={<div className={innerClassName} />}
          disabled={touch}
        >
          {children}
        </MenuContextTrigger>
        <MenuContent compact aria-label={current?.title || label || "Actions"}>
          {items.map((action, at) => (
            <Fragment key={action.key}>
              {at > 0 && (action.group ?? 0) !== (items[at - 1].group ?? 0) ? (
                <MenuSeparator />
              ) : null}
              <MenuItem
                icon={action.icon}
                danger={action.danger}
                disabled={action.disabled}
                onClick={action.run}
              >
                {action.label}
              </MenuItem>
            </Fragment>
          ))}
        </MenuContent>
      </Menu>

      <Drawer open={sheet} onOpenChange={setSheet} side="bottom">
        <DrawerPanel
          title={current?.title || "Actions"}
          handle="Close"
          heading
          fit
        >
          <ul className="flex flex-col p-2">
            {items.map((action, at) => (
              <li
                key={action.key}
                className={cx(
                  at > 0 &&
                    (action.group ?? 0) !== (items[at - 1].group ?? 0) &&
                    "mt-1 border-t border-ui-line pt-1",
                )}
              >
                <TextButton
                  disabled={action.disabled}
                  onClick={() => {
                    setSheet(false);
                    action.run();
                  }}
                  className={cx(
                    "flex min-h-12 w-full items-center gap-3 rounded-[1rem] px-3 text-start text-[0.9375rem] font-bold transition-colors active:bg-ui-tint disabled:opacity-50 [&_svg]:size-5 [&_svg]:text-ui-soft",
                    action.danger && "text-ui-danger [&_svg]:text-ui-danger",
                  )}
                >
                  {action.icon}
                  {action.label}
                </TextButton>
              </li>
            ))}
          </ul>
        </DrawerPanel>
      </Drawer>
    </div>
  );
}
