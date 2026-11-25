"use client";

import { HoverCardContent as Content } from "@ui-sdk/react/hover-card";
import type { ComponentProps } from "react";
import { cx } from "./cx";
import { POPUP } from "./popup";

export { HoverCard, HoverCardTrigger } from "@ui-sdk/react/hover-card";

export function HoverCardContent(
  props: Omit<ComponentProps<typeof Content>, "className">,
) {
  return <Content {...props} className={cx(POPUP, "w-68 gap-1.5")} />;
}
