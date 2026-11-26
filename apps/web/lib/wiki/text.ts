/**
 * Lines a source wrapped by hand, joined back into paragraphs for editing: a
 * list item, a quote, a heading or a table row still starts its own line, and a
 * fenced code block is kept line for line. Only what is edited is saved this
 * way.
 */
export function unwrap(text: string): string {
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== undefined) {
      out.push(line);
      if (
        marker &&
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        line.trim() === marker
      )
        fence = undefined;
      continue;
    }
    if (marker) {
      fence = marker;
      out.push(line);
      continue;
    }
    const last = out.at(-1);
    const starts = /^\s*([-*+] |\d+\. |>|#|\|)/.test(line);
    if (
      last !== undefined &&
      last.trim() !== "" &&
      line.trim() !== "" &&
      !starts &&
      !/^\s*(`{3,}|~{3,})/.test(last)
    )
      out[out.length - 1] = `${last} ${line.trim()}`;
    else out.push(line);
  }
  return out.join("\n");
}

/** A text's first sentence, the summary a page would get without one. */
export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.match(/^.+?[.!?。！？](?=\s|$)/u)?.[0] ?? flat;
}

/** `Happy face` → `happy-face`: a name the picture files and tools take. */
export function toPictureName(words: string): string {
  return words
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Other names, as typed with commas, back to a clean list. */
export function splitAliases(text: string): string[] {
  return text
    .split(/[,、，]/)
    .map((alias) => alias.trim())
    .filter(Boolean);
}
