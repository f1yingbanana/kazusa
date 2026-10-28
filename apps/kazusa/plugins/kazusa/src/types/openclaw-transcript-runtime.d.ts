/**
 * OpenClaw documents and exports this public runtime module, but v2026.10.5
 * omits its declaration file. Remove this when the SDK ships the corresponding
 * types.
 */
declare module "openclaw/plugin-sdk/session-transcript-runtime" {
  import type { SessionCatalogTranscriptItem } from "openclaw/plugin-sdk/session-catalog";

  type SessionIdentity = {
    agentId: string;
    sessionKey: string;
    sessionId: string;
  };

  export function appendSessionTranscriptMessageByIdentity(
    params: SessionIdentity & {
      message: {
        role: "assistant" | "user";
        content: ReadonlyArray<{ type: "text"; text: string }>;
        timestamp: number;
        idempotencyKey?: string;
      };
    },
  ): Promise<{ messageId: string } | undefined>;

  export function appendSessionTranscriptMessageByIdentityStrict(
    params: SessionIdentity & {
      preparation?: { source?: () => void };
      message: {
        role: "assistant" | "user";
        content: ReadonlyArray<{ type: "text"; text: string }>;
        timestamp: number;
        idempotencyKey?: string;
        /** Chat copies carry sender attribution; ledger rows carry `kazusa`. */
        __openclaw?: {
          senderId?: string;
          senderName?: string;
          senderIdentity?: {
            type: "observation";
            id: string;
            pluginId: string;
            accountId: null;
            senderKind: "human" | "bot";
          };
          kazusa?: unknown;
        };
      };
    },
  ): Promise<
    | { kind: "result"; result: { messageId: string } }
    | { kind: "suppressed" }
    | { kind: "rejected"; reason: string }
  >;

  export function publishSessionTranscriptUpdateByIdentity(
    params: SessionIdentity & { update: { messageId: string } },
  ): Promise<void>;

  /** Branch-safe raw message entries; keeps `__openclaw` metadata. */
  export function readVisibleSessionTranscriptMessageEntries(
    params: SessionIdentity & { storePath?: string },
  ): Promise<
    Array<{
      entryId: string;
      seq: number;
      role: string;
      message: {
        role: string;
        content: unknown;
        timestamp?: number;
        __openclaw?: { kazusa?: unknown; [key: string]: unknown };
      };
    }>
  >;

  export function readSessionTranscriptCatalogPage(params: {
    agentId: string;
    sessionKey: string;
    storePath?: string;
    limit: number;
    cursor?: string;
    sourceDomain: string;
    pluginId: string;
  }): Promise<{ items: SessionCatalogTranscriptItem[]; nextCursor?: string }>;
}
