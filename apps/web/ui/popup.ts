/**
 * The surface shared by popovers, menus and hover cards. It grows out of the
 * side it opens from and settles back into it when it closes.
 */
export const POPUP =
  "z-60 flex w-[min(20rem,calc(100vw-2rem))] origin-(--transform-origin) flex-col gap-2.5 rounded-[1.25rem] ui-raised p-4 text-ui-ink transition-[opacity,scale] duration-180 ease-[cubic-bezier(0.2,0.9,0.3,1.15)] data-[ending-style]:scale-96 data-[ending-style]:opacity-0 data-[ending-style]:duration-120 data-[ending-style]:ease-in data-[starting-style]:scale-92 data-[starting-style]:opacity-0 motion-reduce:transition-none";
