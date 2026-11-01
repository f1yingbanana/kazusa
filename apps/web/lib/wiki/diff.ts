export interface DiffLine {
  readonly kind: "same" | "added" | "removed";
  readonly text: string;
}

/** Line diff by longest common subsequence; wiki pages are small. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before ? before.split("\n") : [];
  const b = after ? after.split("\n") : [];
  const lengths = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] =
        a[i] === b[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (
      i < a.length &&
      (j >= b.length || lengths[i + 1][j] >= lengths[i][j + 1])
    ) {
      lines.push({ kind: "removed", text: a[i] });
      i++;
    } else {
      lines.push({ kind: "added", text: b[j] });
      j++;
    }
  }
  return lines;
}

/** Only what changed, with a little context, for reading a night at a glance. */
export function changedOnly(
  lines: readonly DiffLine[],
  context = 1,
): DiffLine[] {
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.kind === "same") return;
    for (let at = index - context; at <= index + context; at++) keep.add(at);
  });
  return lines.filter((_, index) => keep.has(index));
}
