---
name: openclaw-plugins
description:
  "Guidelines for developing OpenClaw plugins: manifest definitions, tool
  registration, clean transport vs. policy separation, resilient schemas, and
  cache lifecycle."
---

# OpenClaw Plugin Development Playbook

This skill outlines best practices for creating, maintaining, and integrating
custom OpenClaw plugins.

---

## 1. Plugin Structure & Manifest

Every OpenClaw plugin must have an `openclaw.plugin.json` alongside its
`package.json`:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "description": "Custom tools and transports for OpenClaw.",
  "main": "dist/index.js",
  "author": "OpenRP",
  "entrypoint": "dist/index.js"
}
```

In `openclaw.json`, enable the plugin via:

```json
"plugins": {
  "entries": {
    "my-plugin": {
      "enabled": true
    }
  }
}
```

---

## 2. Tool Registration & Schema Resiliency

Register tools via the plugin context:

```typescript
api.registerTool({
  name: "relay_thought",
  description:
    "Relay the agent's inner waking thought to the monitoring bus. NEVER call while asleep.",
  parameters: {
    type: "object",
    properties: {
      thought: {
        type: "string",
        description: "The waking thought content.",
      },
    },
    required: ["thought"],
  },
  async execute(params: {
    thought?: string;
    message?: string;
    content?: string;
  }) {
    // Resilient parameter fallback: LLMs occasionally pass 'content' or 'message' instead of 'thought'
    const content = params.thought || params.message || params.content;
    if (!content) {
      throw new Error("Missing required field 'thought'");
    }
    // Execution logic...
    return { ok: true };
  },
});
```

### Schema Best Practices:

1. **Property Aliases**: In tool implementation, accept reasonable property
   aliases (e.g. `thought`, `message`, `content`) to prevent schema failures on
   subtle model variations.
2. **Explicit Negative Constraints**: Include explicit negative boundaries in
   the tool description (e.g. _"NEVER call while asleep; sleeping characters do
   not broadcast thoughts"_). Models respect boundary constraints stated
   directly inside tool parameter descriptions.

---

## 3. Strict Separation of Concerns: Transport vs. Policy

An I/O transport plugin (such as `discord-io`, `telegram-io`) is strictly a
**bidirectional communication bridge**:

- **DO NOT Throttle in the I/O Layer**: Never force turn limits, reply caps,
  cooldown timers, or conversation state machines inside transport plugins.
- **DO NOT Strip Messages Arbitrarily**: Let OpenClaw's context engine and
  session manager decide what messages are preserved and fed to the agent.
- **Where Controls Belong**:
  - Turn loops & runaway execution &rarr; `tools.loopDetection` in
    `openclaw.json`.
  - Conversation pacing & boundaries &rarr; Persona skills (`skills/*`) and
    agent prompts.
  - Rate limiting &rarr; Gateway provider configuration.

---

## 4. Idempotent Provisioning & Cache Hydration

When building plugins that provision channels, threads, or entities on external
platforms (Discord, Slack, Telegram):

1. **Never Trust Cold In-Memory Caches**: On gateway restart, in-memory Maps
   (`channelsByName`, `channelsById`) are completely empty (`size === 0`). Never
   assume a channel does not exist simply because it is missing from a local
   Map.
2. **Always Sync Before Create**: Always run a full remote synchronization (e.g.
   `fetchGuildChannels()`) before evaluating whether to create a new category or
   channel. Creating resources without verifying against the remote API creates
   duplicate channels with identical names.
3. **Idempotent Guarantees**: Every creation function must follow:
   ```typescript
   async function getOrCreateChannel(name: string) {
     await ensureHydrated();
     const existing = findExisting(name);
     if (existing) return existing;
     return await createRemoteChannel(name);
   }
   ```

---

## 5. Explicit Messaging vs. Heartbeat Sessions

- Background cron jobs (heartbeats) run in isolated sessions with
  `delivery: none`. Any freeform assistant text emitted at the end of a cron
  turn is logged and discarded—it is **never** delivered to chat channels.
- To send an external message during a background routine, the agent **must
  explicitly invoke a registered messaging tool** (e.g. `send_message`).
- Transport plugins must ensure that messages sent via `send_message` are
  properly routed and recorded into OpenClaw's session history so future replies
  retain the context.
