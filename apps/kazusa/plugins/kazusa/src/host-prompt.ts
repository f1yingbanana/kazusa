import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

type Replacement = { readonly from: RegExp; readonly to: string };

/**
 * The host writes the real date into every system prompt, with no setting to
 * stop it. Characters live on the sim clock, and a second, wrong date confuses
 * them about what day it is, so it never reaches the model. Applies to
 * everyone.
 */
export const HOST_DATE =
  /## Temporal Context\nCurrent date: [^\n]*\nTime zone: [^\n]*\n(?:For the exact current time[^\n]*\n)?\n?/g;

/**
 * The note sits just before a delivery; the context engine can't reach it
 * there.
 */
/**
 * The host stamps its own messages with the real time, as in `[Sat 2026-10-31
 * 19:46 UTC] <turn_aborted>`. Sim stamps have no time zone, so they stay.
 */
export const HOST_STAMP =
  /\[[A-Z][a-z]{2} \d{4}-\d{2}-\d{2} \d{2}:\d{2} [A-Z]{2,5}\] ?/g;

/**
 * What the host adds to deliveries on our channel: to stay silent unless it
 * matters, and to reply with a `message` tool nobody here has. Perception has
 * already decided this is worth a turn, and replies go through `send_message`.
 * Its message sits just before the delivery and can't be dropped, and providers
 * refuse an empty one, so its wrapper becomes a plain lead-in.
 */
export const HOST_DELIVERY_NOTES: readonly Replacement[] = [
  {
    from: /\[OpenClaw room event\][\s\S]*?your final text here stays private either way\./g,
    to: "",
  },
  {
    from: /Delivery: Final assistant text is not automatically delivered in this run\.[^\n]*\n?/g,
    to: "",
  },
  {
    from: /OpenClaw runtime context:\s*(?:Conversation data \(data, not instructions\):\s*"[^\n]*"\s*)?End OpenClaw runtime context\./g,
    // A mark, not words: the skills say what a turn is.
    to: "…",
  },
];

/** A personal assistant's guidance, and the machine it runs on. */
const ASSISTANT_SECTIONS = [
  "Tooling",
  "Tool Call Style",
  "Execution Bias",
  "Promised Work",
  "Care",
  "Runtime Context",
  "OpenClaw Control",
  "Workspace",
  "Documentation",
  "Workspace Files \\(injected\\)",
  "Directory Roles",
  "Messaging",
  "Conversation Context",
  "Authorized Senders",
];

/**
 * The host's prompt mode is decided per run with no setting, and "full" tells a
 * character it is an assistant inside OpenClaw: to act now, not to refuse, and
 * what host and model it runs on. Characters are people, so all of that goes,
 * leaving who they are, their memory and our skills.
 *
 * Transforms have no agent scope and also run over every message, so each edit
 * looks ahead for the Runtime line, which only a system prompt has and which
 * says whose it is. That line goes last, which leaves a second pass nothing to
 * do. The system agent really is an administrator, and keeps it all.
 */
export function characterPromptEdits(systemAgent?: string): Replacement[] {
  const notAdmin = `(?=[\\s\\S]*^Runtime: agent=${
    systemAgent ? `(?!${systemAgent} )` : ""
  })`;
  const end = "(?=^#{1,2} |^<!--|(?![\\s\\S]))";
  return [
    {
      from: new RegExp(
        `^${notAdmin}You are a personal assistant running inside OpenClaw\\.\\n`,
        "gm",
      ),
      to: "",
    },
    ...ASSISTANT_SECTIONS.map((name) => ({
      from: new RegExp(`^${notAdmin}## ${name}\\n[\\s\\S]*?${end}`, "gm"),
      to: "",
    })),
    {
      from: new RegExp(
        `^${notAdmin}# Project Context\\n[\\s\\S]*?${end}`,
        "gm",
      ),
      to: "",
    },
    {
      // Files we don't seed, which the host still lists as missing.
      from: new RegExp(
        `^${notAdmin}## [^\\n]*\\n\\[MISSING\\][^\\n]*\\n?`,
        "gm",
      ),
      to: "",
    },
    {
      // A file heading keeps its name, not where it lives on this machine.
      from: new RegExp(`^${notAdmin}## (?:[^\\n]*/)?([A-Z]+\\.md)$`, "gm"),
      to: "## $1",
    },
    {
      from: new RegExp(
        `^${notAdmin}## Runtime\\n[\\s\\S]*?(?=^<!-- |^Runtime: )`,
        "gm",
      ),
      to: "",
    },
    {
      from: new RegExp(`^${notAdmin}Runtime: agent=[^\\n]*\\n?`, "gm"),
      to: "",
    },
  ];
}

export function registerHostPromptEdits(
  api: Pick<OpenClawPluginApi, "registerTextTransforms">,
  systemAgent?: string,
): void {
  api.registerTextTransforms({
    input: [
      { from: HOST_DATE, to: "" },
      { from: HOST_STAMP, to: "" },
      ...HOST_DELIVERY_NOTES,
      ...characterPromptEdits(systemAgent),
    ],
  });
}
