import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

/**
 * Exercise the installed SDK in an isolated process, including its SQLite
 * workers.
 */
it("round-trips attribution and idempotency through native transcript storage and catalog", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kazusa-transcript-"));
  try {
    const check = promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
        import assert from "node:assert/strict";
        import path from "node:path";
        import { patchSessionEntry } from "openclaw/plugin-sdk/session-store-runtime";
        import {
          appendSessionTranscriptMessageByIdentityStrict as append,
          readSessionTranscriptCatalogPage as read,
          readVisibleSessionTranscriptMessageEntries as readVisible,
        } from "openclaw/plugin-sdk/session-transcript-runtime";

        const warnings = [];
        process.on("warning", warning => warnings.push(warning));
        let active = true;
        const preparation = { source: () => assert.ok(active, "Messaging owner disposed") };

        const target = {
          agentId: "bob", sessionKey: "agent:bob:chat:group:club",
          sessionId: "test-session",
          storePath: path.join(process.env.OPENCLAW_STATE_DIR, "bob", "sessions.json"),
        };
        await patchSessionEntry({
          ...target, fallbackEntry: { sessionId: target.sessionId, updatedAt: Date.now() },
          update: () => ({ sessionId: target.sessionId }),
        });
        const message = {
          role: "user", content: [{ type: "text", text: "Hello Bob" }],
          timestamp: 1793016000000, idempotencyKey: "kazusa:message:test:bob",
          __openclaw: {
            senderId: "alice", senderName: "Alice Lin",
            senderIdentity: { type: "observation", id: "alice", pluginId: "kazusa", accountId: null, senderKind: "bot" },
          },
        };
        const first = await append({ ...target, message, preparation });
        const retry = await append({ ...target, message, preparation });
        assert.equal(first.kind, "result");
        assert.equal(retry.kind, "result");
        assert.equal(first.result.appended, true);
        assert.equal(retry.result.appended, false);
        assert.equal(first.result.messageId, retry.result.messageId);
        const page = await read({ ...target, limit: 10, sourceDomain: "kazusa", pluginId: "kazusa" });
        assert.equal(page.items.length, 1);
        assert.equal(page.items[0].type, "userMessage");
        assert.equal(page.items[0].text, "Hello Bob");
        assert.equal(page.items[0].timestamp, "2026-10-26T12:00:00.000Z");
        assert.deepEqual(page.items[0].sender, {
          identity: message.__openclaw.senderIdentity, label: "Alice Lin",
        });
        const outgoing = {
          ...message, role: "assistant", idempotencyKey: "kazusa:message:reply:bob",
          content: [{ type: "text", text: "Hello Alice" }],
          __openclaw: {
            senderId: "bob", senderName: "Bob",
            senderIdentity: { ...message.__openclaw.senderIdentity, id: "bob" },
          },
        };
        await append({ ...target, message: outgoing, preparation });
        const visible = await readVisible(target);
        assert.deepEqual(visible.map(entry => entry.message.__openclaw.senderIdentity.id), ["alice", "bob"]);
        const updated = await read({ ...target, limit: 10, sourceDomain: "kazusa", pluginId: "kazusa" });
        assert.equal(updated.items[0].type, "agentMessage");
        // Installed 2026.10.5 retains outgoing attribution but omits it from
        // catalog projections. The context renderer must report unknown.
        assert.equal(updated.items[0].sender, undefined);
        active = false;
        await assert.rejects(append({ ...target, message: { ...message, idempotencyKey: "new-copy" }, preparation }), /Messaging owner disposed/);
        active = true;
        await patchSessionEntry({ ...target, update: () => ({ sessionId: "replacement" }) });
        assert.deepEqual(await append({ ...target, message, preparation }), { kind: "rejected", reason: "session-rebound" });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(warnings.some(warning => warning.code === "DEP_SESSION_PERSISTENCE"), false);
      `,
      ],
      {
        env: {
          ...process.env,
          OPENCLAW_STATE_DIR: root,
          OPENCLAW_CONFIG_PATH: path.join(root, "openclaw.json"),
        },
        timeout: 20_000,
      },
    );
    await expect(check).resolves.toMatchObject({ stdout: "" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 25_000);
