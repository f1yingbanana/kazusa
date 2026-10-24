/**
 * OpenClaw documents and exports this public runtime module, but v2026.10.5
 * omits its declaration file. Remove this when the SDK ships the corresponding
 * types.
 */
declare module "openclaw/plugin-sdk/session-transcript-runtime" {
  type SessionIdentity = {
    agentId: string;
    sessionKey: string;
    sessionId: string;
  };

  export function appendSessionTranscriptMessageByIdentity(
    params: SessionIdentity & {
      message: {
        role: "assistant";
        content: ReadonlyArray<{ type: "text"; text: string }>;
        timestamp: number;
      };
    },
  ): Promise<{ messageId: string } | undefined>;

  export function publishSessionTranscriptUpdateByIdentity(
    params: SessionIdentity & { update: { messageId: string } },
  ): Promise<void>;
}
