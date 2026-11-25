import type { ComponentProps } from "react";

export function VisuallyHidden(
  props: Omit<ComponentProps<"span">, "className">,
) {
  return <span {...props} className="sr-only" />;
}
