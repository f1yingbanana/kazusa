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
      !/^\s*(`{3,}|~{3,})/.test(last) &&
      !/^\s*#{1,6}(\s|$)/.test(last)
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

/**
 * A page's Markdown made into a copy: its new name in the front matter and the
 * title, no other names (they would point at both), and a place's id the new
 * page's own, as two places can't share one.
 */
export function duplicateSource(
  text: string,
  copy: { readonly name: string; readonly id: string },
): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const front = match?.[1] ?? "";
  let body = match ? text.slice(match[0].length) : text;
  const lines: string[] = [];
  let inAliases = false;
  for (const line of front ? front.split(/\r?\n/) : []) {
    if (inAliases && (/^\s*-/.test(line) || /^\s+\S/.test(line))) continue;
    inAliases = false;
    if (/^aliases:/.test(line)) {
      inAliases = /^aliases:\s*$/.test(line);
      continue;
    }
    if (/^name:/.test(line)) lines.push(`name: ${JSON.stringify(copy.name)}`);
    else if (/^place_id:/.test(line)) lines.push(`place_id: ${copy.id}`);
    else lines.push(line);
  }
  if (!lines.some((line) => line.startsWith("name:")))
    lines.unshift(`name: ${JSON.stringify(copy.name)}`);
  body = /^\s*# .*$/m.test(body)
    ? body.replace(/^(\s*)# .*$/m, `$1# ${copy.name}`)
    : `# ${copy.name}\n\n${body}`;
  return `---\n${lines.join("\n")}\n---\n${body.startsWith("\n") ? "" : "\n"}${body}`;
}
