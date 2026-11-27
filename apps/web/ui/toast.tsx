"use client";

import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastRegion,
  ToastTitle,
} from "@ui-sdk/react/toast";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useSyncExternalStore } from "react";

export { toast } from "@ui-sdk/react/toast";

const MOBILE_QUERY = "(max-width: 767px)";

const subscribeMobile = (listener: () => void) => {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
};

function useMobileToasts(): boolean {
  return useSyncExternalStore(
    subscribeMobile,
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

/*
  Desktop floats at the top centre; phones anchor above the bottom SectionNav
  bar so notifications never cover the top bar or page title and stay in reach
  of the thumb. Each toast is placed absolutely and given its own measured
  height, so the stack animates outward cleanly on either edge.
*/
const REGION =
  "fixed top-[max(0.75rem,env(safe-area-inset-top))] data-[side=bottom]:top-auto data-[side=bottom]:bottom-[calc(4.25rem+var(--keyboard-inset,0px)+env(safe-area-inset-bottom))] left-1/2 z-80 w-[min(24rem,calc(100vw-1.5rem))] -translate-x-1/2 h-(--toast-front-height) data-expanded:h-[calc(var(--toast-stack-height)+(var(--toast-count)-1)*0.5rem)]";

const ITEM =
  "absolute inset-x-0 top-0 in-data-[side=bottom]:top-auto in-data-[side=bottom]:bottom-0 z-[calc(100-var(--toast-index))] flex h-(--toast-height) items-start gap-2.5 overflow-hidden rounded-[1.25rem] ui-raised p-3 ps-3.5 text-ui-ink select-none [--y:calc(var(--toast-index)*10px)] in-data-[side=bottom]:[--y:calc(var(--toast-index)*-10px)] translate-x-(--toast-swipe-x,0px) translate-y-[calc(var(--y)+var(--toast-swipe-y,0px))] scale-[calc(1-var(--toast-index)*0.05)] transition-[translate,scale,opacity,height] duration-400 ease-[cubic-bezier(0.2,0.9,0.3,1)] not-data-front:not-data-expanded:h-(--toast-front-height) data-expanded:scale-100 data-expanded:[--y:calc(var(--toast-offset)+var(--toast-index)*0.5rem)] in-data-[side=bottom]:data-expanded:[--y:calc((var(--toast-offset)+var(--toast-index)*0.5rem)*-1)] data-starting-style:transition-none data-starting-style:data-front:[--y:-120%] in-data-[side=bottom]:data-starting-style:data-front:[--y:120%] data-starting-style:not-data-front:opacity-0 data-ending-style:opacity-0 data-swiping:transition-none motion-reduce:transition-opacity [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0";

const TYPE_ICON =
  "hidden text-ui-soft in-data-[type=error]:text-ui-danger in-data-[type=success]:text-ui-ok in-data-[type=warning]:text-ui-accent-ink";

/** Where every `toast()` shows. Mount once, at the root of the shell. */
export function Toasts({ side }: { side?: "top" | "bottom" } = {}) {
  const mobile = useMobileToasts();
  const resolvedSide = side ?? (mobile ? "bottom" : "top");

  return (
    <ToastRegion side={resolvedSide} align="center" className={REGION}>
      {() => (
        <Toast className={ITEM}>
          <CircleCheckIcon
            aria-hidden
            className={`${TYPE_ICON} in-data-[type=success]:block`}
          />
          <InfoIcon
            aria-hidden
            className={`${TYPE_ICON} in-data-[type=info]:block`}
          />
          <TriangleAlertIcon
            aria-hidden
            className={`${TYPE_ICON} in-data-[type=warning]:block`}
          />
          <CircleAlertIcon
            aria-hidden
            className={`${TYPE_ICON} in-data-[type=error]:block`}
          />
          <LoaderCircleIcon
            aria-hidden
            className={`${TYPE_ICON} in-data-[type=loading]:block motion-safe:animate-ui-spin`}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-px">
            <ToastTitle className="text-sm leading-snug font-bold text-pretty" />
            <ToastDescription className="text-[0.8125rem] leading-normal text-pretty text-ui-soft empty:hidden" />
            <ToastAction className="mt-2 inline-flex h-7.5 self-start items-center rounded-full bg-ui-primary px-3 text-[0.8125rem] font-bold text-ui-on-primary transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary active:scale-95 data-pending:opacity-60" />
          </div>
          <ToastClose
            aria-label="Dismiss"
            className="-me-1 grid size-7 shrink-0 place-items-center rounded-full text-ui-soft hover:bg-ui-tint hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-ui-primary [&_svg]:size-3.5"
          >
            <XIcon aria-hidden />
          </ToastClose>
        </Toast>
      )}
    </ToastRegion>
  );
}
