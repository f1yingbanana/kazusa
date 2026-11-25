/*
  Where the last talk was opened from on screen (a row, a marker), so the talk
  can grow out of that spot and shrink back into it. Read once by the talk that
  opens next.
*/
let origin: { x: number; y: number } | null = null;

export function rememberTalkOrigin(element: Element | null): void {
  if (!element) return;
  const rect = element.getBoundingClientRect();
  origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function takeTalkOrigin(): { x: number; y: number } | null {
  const taken = origin;
  origin = null;
  return taken;
}
