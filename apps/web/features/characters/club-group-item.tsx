"use client";

import type { CharacterSummary } from "@kazusa/client";
import { CheckIcon, ChevronRightIcon, MinusIcon, PlusIcon } from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { firstName } from "@/lib/format";
import type { Group } from "@/lib/state/grouping";
import { avatarCountClass, AvatarStack } from "@/ui/avatar";
import { IconButton } from "@/ui/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/ui/collapsible";
import { cx } from "@/ui/cx";

interface FlipSnapshot {
  readonly rect: DOMRect;
  readonly clone: HTMLElement;
}

export interface ClubGroupMemberState {
  readonly current?: boolean;
  readonly active: boolean;
  readonly dim?: boolean;
  readonly actionLabel: string;
  readonly onClick: () => void;
  readonly onToggle: () => void;
}

/**
 * Collapsible club/group row with Timeline's FLIP avatar-stack morph and
 * `+`/`✓`/`−` selection controls, shared by Timeline and Setup's cast picker.
 */
export function ClubGroupItem({
  group,
  open,
  onOpenChange,
  highlight = "none",
  groupPressed,
  onPressGroup,
  groupAction,
  memberState,
  renderAvatar,
  currentStyle = "primary",
}: {
  group: Group;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  highlight?: "sole" | "all" | "some" | "none";
  groupPressed?: boolean;
  onPressGroup?: () => void;
  groupAction?: {
    readonly active: boolean;
    readonly label: string;
    readonly onToggle: () => void;
  };
  memberState: (member: CharacterSummary) => ClubGroupMemberState;
  renderAvatar: (member: CharacterSummary, size: "xs" | "sm") => ReactNode;
  currentStyle?: "primary" | "tint";
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stripAvatarRefs = useRef(new Map<string, HTMLSpanElement>());
  const stripOverflowRef = useRef<HTMLSpanElement>(null);
  const rowAvatarRefs = useRef(new Map<string, HTMLSpanElement>());
  const pendingFlip = useRef<{
    dir: "expand" | "collapse";
    snapshots: Map<string, FlipSnapshot>;
    overflowRect?: DOMRect;
  } | null>(null);

  const memberPreview = group.members.map((m) => firstName(m.name)).join(", ");
  const overflow = group.members.length >= 5 ? group.members.length - 3 : 0;
  const stripMembers = overflow > 0 ? group.members.slice(0, 3) : group.members;

  function captureAndToggle(nextOpen: boolean) {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!reduced && typeof Element.prototype.animate === "function") {
      const source = nextOpen ? stripAvatarRefs.current : rowAvatarRefs.current;
      const snapshots = new Map<string, FlipSnapshot>();
      for (const [id, el] of source) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          snapshots.set(id, {
            rect,
            clone: el.cloneNode(true) as HTMLElement,
          });
        }
      }
      const overflowRect = nextOpen
        ? stripOverflowRef.current?.getBoundingClientRect()
        : undefined;
      if (snapshots.size > 0) {
        pendingFlip.current = {
          dir: nextOpen ? "expand" : "collapse",
          snapshots,
          overflowRect:
            overflowRect && overflowRect.width > 0 ? overflowRect : undefined,
        };
      }
    }
    onOpenChange(nextOpen);
  }

  useLayoutEffect(() => {
    const flip = pendingFlip.current;
    pendingFlip.current = null;
    const root = rootRef.current;
    if (!flip || !root) return;
    if (flip.dir === "expand" && !open) return;
    if (flip.dir === "collapse" && open) return;

    const rootRect = root.getBoundingClientRect();
    const targets =
      flip.dir === "expand" ? rowAvatarRefs.current : stripAvatarRefs.current;
    const overlay = document.createElement("div");
    overlay.setAttribute("aria-hidden", "true");
    overlay.className = "pointer-events-none absolute inset-0 z-20";
    root.appendChild(overlay);

    const hiddenElements: HTMLSpanElement[] = [];
    const animations: Animation[] = [];

    if (flip.dir === "collapse") {
      for (const sourceEl of rowAvatarRefs.current.values()) {
        sourceEl.style.opacity = "0";
        hiddenElements.push(sourceEl);
      }
    }

    const overflowTargetRect =
      flip.dir === "collapse"
        ? stripOverflowRef.current?.getBoundingClientRect()
        : undefined;

    let index = 0;
    for (const [id, { rect: fromRect, clone }] of flip.snapshots) {
      const target = targets.get(id);
      const targetRect = target?.getBoundingClientRect();
      const hasDirectTarget = Boolean(
        target && targetRect && targetRect.width > 0,
      );
      const toRect = hasDirectTarget
        ? targetRect
        : flip.dir === "collapse" &&
            overflowTargetRect &&
            overflowTargetRect.width > 0
          ? overflowTargetRect
          : undefined;

      if (!toRect) continue;

      if (hasDirectTarget && target) {
        target.style.opacity = "0";
        hiddenElements.push(target);
      }

      clone.style.position = "absolute";
      clone.style.left = `${fromRect.left - rootRect.left}px`;
      clone.style.top = `${fromRect.top - rootRect.top}px`;
      clone.style.width = `${fromRect.width}px`;
      clone.style.height = `${fromRect.height}px`;
      clone.style.margin = "0";
      clone.style.transformOrigin = "top left";
      overlay.appendChild(clone);

      const dx = toRect.left - fromRect.left;
      const dy = toRect.top - fromRect.top;
      const scale = toRect.width / fromRect.width;

      const anim = clone.animate(
        hasDirectTarget
          ? [
              { transform: "translate(0px, 0px) scale(1)" },
              { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
            ]
          : [
              { transform: "translate(0px, 0px) scale(1)", opacity: 1 },
              {
                transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
                opacity: 0,
              },
            ],
        {
          duration: 200,
          delay: index * 8,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "both",
        },
      );
      anim.onfinish = () => {
        if (hasDirectTarget && target) target.style.opacity = "";
        clone.remove();
      };
      animations.push(anim);
      index += 1;
    }

    if (flip.dir === "expand" && flip.overflowRect) {
      for (const [id, target] of targets) {
        if (flip.snapshots.has(id)) continue;
        const toRect = target.getBoundingClientRect();
        if (toRect.width === 0) continue;
        const clone = target.cloneNode(true) as HTMLElement;
        target.style.opacity = "0";
        hiddenElements.push(target);

        const fromRect = flip.overflowRect;
        clone.style.position = "absolute";
        clone.style.left = `${fromRect.left - rootRect.left}px`;
        clone.style.top = `${fromRect.top - rootRect.top}px`;
        clone.style.width = `${toRect.width}px`;
        clone.style.height = `${toRect.height}px`;
        clone.style.margin = "0";
        clone.style.transformOrigin = "top left";
        overlay.appendChild(clone);

        const dx = toRect.left - fromRect.left;
        const dy = toRect.top - fromRect.top;
        const startScale = fromRect.height / toRect.height;

        const anim = clone.animate(
          [
            {
              transform: `translate(0px, 0px) scale(${startScale})`,
              opacity: 0,
            },
            { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 1 },
          ],
          {
            duration: 200,
            delay: index * 8,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            fill: "both",
          },
        );
        anim.onfinish = () => {
          target.style.opacity = "";
          clone.remove();
        };
        animations.push(anim);
        index += 1;
      }
    }

    if (animations.length === 0) {
      for (const el of hiddenElements) el.style.opacity = "";
      overlay.remove();
      return;
    }

    return () => {
      for (const anim of animations) anim.cancel();
      for (const el of hiddenElements) el.style.opacity = "";
      overlay.remove();
    };
  }, [open]);

  const summary = (
    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="truncate text-[0.9375rem] leading-tight font-bold text-ui-ink">
        {group.label}
      </span>
      <span className="flex h-5 items-center overflow-hidden">
        <span
          className={cx(
            "flex shrink-0 items-center overflow-hidden transition-[max-width,opacity,margin] duration-200 motion-reduce:transition-none",
            open ? "me-0 max-w-0 opacity-0" : "me-2 max-w-28 opacity-100",
          )}
        >
          <AvatarStack size="xs">
            {stripMembers.map((m) => (
              <span
                key={m.id}
                ref={(el) => {
                  if (el) stripAvatarRefs.current.set(m.id, el);
                  else stripAvatarRefs.current.delete(m.id);
                }}
                className={cx(
                  "inline-flex shrink-0",
                  memberState(m).dim ? "opacity-50 grayscale" : "opacity-100",
                )}
              >
                {renderAvatar(m, "xs")}
              </span>
            ))}
            {overflow > 0 ? (
              <span
                ref={stripOverflowRef}
                aria-hidden="true"
                className={cx("relative", avatarCountClass("xs"))}
              >
                {`+${overflow}`}
              </span>
            ) : null}
          </AvatarStack>
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ui-soft">
          {memberPreview}
        </span>
      </span>
    </span>
  );

  return (
    <div ref={rootRef} role="listitem" className="relative flex flex-col">
      <Collapsible
        open={open}
        onOpenChange={captureAndToggle}
        className="flex flex-col"
      >
        <div
          className={cx(
            "flex items-center gap-1.5 rounded-[1rem] px-1.5 transition-colors duration-150",
            highlight === "sole"
              ? "bg-ui-surface inset-ring-2 inset-ring-ui-primary"
              : highlight === "all"
                ? "bg-ui-surface inset-ring inset-ring-ui-primary/50"
                : highlight === "some"
                  ? "bg-ui-tint/70"
                  : "hover:bg-ui-tint/70",
          )}
        >
          {onPressGroup ? (
            <>
              <CollapsibleTrigger
                aria-label={`Show people in ${group.label}`}
                className="group/club grid size-7 shrink-0 place-items-center rounded-full text-ui-soft transition-colors duration-150 hover:bg-ui-surface hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-ui-primary"
              >
                <ChevronRightIcon
                  aria-hidden
                  className="size-4 transition-transform duration-200 group-aria-expanded/club:rotate-90 rtl:rotate-180"
                />
              </CollapsibleTrigger>
              <button
                type="button"
                aria-pressed={groupPressed}
                className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-[0.875rem] py-2.5 pe-2 text-start focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-primary"
                onClick={onPressGroup}
              >
                {summary}
              </button>
            </>
          ) : (
            <CollapsibleTrigger
              aria-label={`Show people in ${group.label}`}
              className="group/club flex min-w-0 flex-1 items-center gap-2 rounded-[0.875rem] px-1 py-2.5 text-start focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ui-primary"
            >
              <ChevronRightIcon
                aria-hidden
                className="size-4 shrink-0 text-ui-soft transition-transform duration-200 group-aria-expanded/club:rotate-90 rtl:rotate-180"
              />
              {summary}
            </CollapsibleTrigger>
          )}

          {groupAction ? (
            <IconButton
              size="sm"
              tone="ghost"
              className={
                groupAction.active
                  ? "bg-ui-primary/14 text-ui-primary hover:bg-ui-primary/22"
                  : undefined
              }
              label={groupAction.label}
              onClick={groupAction.onToggle}
            >
              {groupAction.active ? (
                <CheckIcon aria-hidden />
              ) : (
                <PlusIcon aria-hidden />
              )}
            </IconButton>
          ) : null}
        </div>

        <CollapsiblePanel className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
          <ul className="relative ms-5 mt-1 flex flex-col gap-1 ps-2.5 pe-1.5 pb-1.5 before:absolute before:inset-y-1 before:inset-s-0 before:w-px before:bg-ui-line">
            {group.members.map((character) => {
              const state = memberState(character);
              return (
                <li key={character.id} className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-current={state.current ? "true" : undefined}
                    className={cx(
                      "flex min-w-0 flex-1 items-center gap-3 rounded-[0.875rem] px-2.5 py-2 text-start text-sm font-semibold text-ui-ink transition-colors duration-150 hover:bg-ui-tint focus-visible:outline-2 focus-visible:outline-ui-primary",
                      currentStyle === "primary"
                        ? "aria-current:bg-ui-surface aria-current:font-bold aria-current:text-ui-primary"
                        : "aria-current:bg-ui-tint aria-current:font-bold aria-current:inset-ring aria-current:inset-ring-ui-line",
                    )}
                    onClick={state.onClick}
                  >
                    <span
                      ref={(el) => {
                        if (el) rowAvatarRefs.current.set(character.id, el);
                        else rowAvatarRefs.current.delete(character.id);
                      }}
                      className="inline-flex shrink-0"
                    >
                      <span
                        className={cx(
                          "inline-flex transition-[filter,opacity] duration-150",
                          state.dim ? "opacity-50 grayscale" : "opacity-100",
                        )}
                      >
                        {renderAvatar(character, "sm")}
                      </span>
                    </span>
                    <span
                      className={cx(
                        "min-w-0 flex-1 truncate",
                        state.dim && "text-ui-soft",
                      )}
                    >
                      {character.name}
                    </span>
                  </button>
                  <IconButton
                    size="sm"
                    tone="ghost"
                    className={
                      state.active
                        ? "bg-ui-primary/14 text-ui-primary hover:bg-ui-primary/22"
                        : undefined
                    }
                    label={state.actionLabel}
                    onClick={state.onToggle}
                  >
                    {state.active ? (
                      <MinusIcon aria-hidden />
                    ) : (
                      <PlusIcon aria-hidden />
                    )}
                  </IconButton>
                </li>
              );
            })}
          </ul>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}
