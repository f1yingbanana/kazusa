import { cx } from "@/ui/cx";
import { RichText } from "../wiki/links";

/**
 * The little Markdown pages use: paragraphs, bulleted lists (a wrapped bullet
 * goes on), quotes and emphasis, with `[[links]]` live. Lines a source wraps
 * join up.
 */
export function Prose({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const blocks = text.split(/\n\s*\n/).filter((block) => block.trim());
  return (
    <div
      className={cx(
        "flex flex-col gap-3 text-[0.9375rem] leading-[1.65] text-pretty",
        className,
      )}
    >
      {blocks.map((block, index) => {
        const lines = block.split(/\n/);
        if (/^\s*#{1,6}\s/.test(lines[0] ?? "")) {
          const rest = lines.slice(1).join("\n").trim();
          return (
            <div key={index} className="flex flex-col gap-3">
              <h4 className="pt-1 text-sm font-extrabold">
                <RichText text={lines[0].replace(/^\s*#{1,6}\s+/, "")} />
              </h4>
              {rest ? <Prose text={rest} className={className} /> : null}
            </div>
          );
        }
        if (/^\s*[-*] /.test(lines[0] ?? "")) {
          const items: string[] = [];
          for (const line of lines) {
            if (/^\s*[-*] /.test(line))
              items.push(line.replace(/^\s*[-*] /, ""));
            else if (items.length) items[items.length - 1] += ` ${line.trim()}`;
          }
          return (
            <ul
              key={index}
              className="flex list-disc flex-col gap-1 ps-5 marker:text-ui-soft"
            >
              {items.map((item, at) => (
                <li key={at}>
                  <RichText text={item} />
                </li>
              ))}
            </ul>
          );
        }
        if (lines.every((line) => /^\s*>/.test(line)))
          return (
            <blockquote
              key={index}
              className="border-s-2 border-ui-line ps-3 text-ui-soft italic"
            >
              <RichText
                text={lines
                  .map((line) => line.replace(/^\s*>\s?/, ""))
                  .join(" ")}
              />
            </blockquote>
          );
        return (
          <p key={index}>
            <RichText text={lines.map((line) => line.trim()).join(" ")} />
          </p>
        );
      })}
    </div>
  );
}
