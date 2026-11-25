"use client";

import type { WikiPage } from "@kazusa/client";
import { LockIcon } from "lucide-react";
import { privateTo } from "@/lib/characters/cast-book";
import { RichText } from "../legacy";
import { Prose } from "../entities/prose";

/** Openings often begin with the summary; the page says it once. */
export function leadAfterSummary(page: WikiPage): string {
  const summary = page.summary.trim();
  const lead = page.lead.trim();
  if (!summary) return lead;
  const words = summary
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const match = new RegExp(`^${words.join("\\s+")}(?=$|[\\s\\p{P}])`, "u").exec(
    lead,
  );
  return match ? lead.slice(match[0].length).trim() : lead;
}

/**
 * A World Wiki page below its title: the summary in bold, the rest of the
 * opening, each section, then its history. A section only its subject knows
 * (their inner voice, on their own page) is marked, since nobody else ever
 * reads it. The same for a person, a place, a group or a thing.
 */
export function WikiPageBody({
  page,
  subject,
  subjectName,
}: {
  page: WikiPage;
  /** Whose page it is, when it is someone's: their sections are marked. */
  subject?: string | undefined;
  subjectName?: string | undefined;
}) {
  const summary = page.summary.trim();
  const lead = leadAfterSummary(page);
  return (
    <div className="flex max-w-160 flex-col gap-8">
      {summary || lead ? (
        <div className="flex flex-col gap-3">
          {summary ? (
            <p className="text-[0.9375rem] leading-[1.65] font-bold text-pretty">
              <RichText text={summary} />
            </p>
          ) : null}
          {lead ? <Prose text={lead} /> : null}
        </div>
      ) : null}

      {page.sections.map((section) => {
        const own = subject ? privateTo(section.knownBy, subject) : false;
        return (
          <section
            key={section.title}
            aria-label={section.title}
            className="flex flex-col gap-2 border-t border-ui-line pt-4"
          >
            <h3 className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-extrabold">
              {section.title}
              {own && subjectName ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-ui-accent-tint px-2 py-0.5 text-xs font-bold text-ui-accent-ink [&_svg]:size-3"
                  title={`Only ${subjectName} reads this, as their own thoughts.`}
                >
                  <LockIcon aria-hidden />
                  {`Only ${subjectName}`}
                </span>
              ) : null}
            </h3>
            <Prose text={section.text} />
          </section>
        );
      })}

      {page.history.length ? (
        <section
          aria-label="History"
          className="flex flex-col gap-3 border-t border-ui-line pt-4"
        >
          <h3 className="text-[0.9375rem] font-extrabold">History</h3>
          <ol className="flex flex-col gap-2.5">
            {page.history.map((entry) => (
              <li
                key={`${entry.date}${entry.text}`}
                className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 text-[0.9375rem] leading-relaxed max-sm:grid-cols-1 max-sm:gap-0.5"
              >
                <span className="pt-0.5 text-xs font-bold text-ui-soft tabular-nums">
                  {entry.date}
                </span>
                <span>
                  <RichText text={entry.text} />
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
