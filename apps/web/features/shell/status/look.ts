/*
  One rule for the status bar: what you can press is drawn in the primary
  colour and underlines under the pointer; what only reports is soft text.
  A press that opens a list beside it carries a chevron as well.
*/
const PRESSABLE =
  "inline-flex items-center gap-1 rounded-[0.375rem] font-bold decoration-[color-mix(in_oklch,currentColor,transparent_50%)] underline-offset-[3px] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary data-open:underline [&_svg]:size-3.5 [&_svg]:shrink-0";

export const STATUS_LINK = `${PRESSABLE} text-ui-primary`;

export const STATUS_DANGER = `${PRESSABLE} text-ui-danger`;
