---
name: openclaw-context-engine
description:
  "Architecture and implementation guidelines for OpenClaw Context Engines:
  cross-session context assembly, direct session topology, token budgeting, and
  message grouping."
---

# OpenClaw Context Engine & Session Architecture

This skill defines how to design, assemble, and inject cross-session
conversational and simulation context in OpenClaw.

---

## 1. Multi-Chat vs. Single-Chat Mental Model

In standard chatbot runtimes, a single linear transcript is the entire universe.
In an autonomous multi-agent simulation:

- An agent participates in **multiple simultaneous channels**: direct messages
  with the user/mentor, group chats with peers, communal spaces, and an isolated
  stream of inner thoughts.
- When an agent reacts to an incoming message or executes a daytime heartbeat
  tick, they need **holistic recent awareness**:
  1. What was just said in **this specific chat**.
  2. What they thought and said to **everyone else in the last 24 hours**.

---

## 2. Direct Session Topology & Memory Preservation

OpenClaw associates durable agent memory (`MEMORY.md`) with direct sessions:

- **Always use deterministic direct session keys**:
  - Direct 1:1 chats: `discord:direct:${channelId}`
  - Inner thoughts: `agent:${agentId}:thoughts`
  - Group chats: `discord:group:${channelId}`
- **Never create ephemeral, one-off session keys**: Dynamic random session IDs
  prevent OpenClaw from loading and persisting `MEMORY.md`.
- **There is no single "main session"**: An agent can live in dozens of
  concurrent sessions; the context engine bridges them seamlessly.

---

## 3. Context Assembly Pipeline

When assembling the prompt for a turn (heartbeat tick or message reaction):

```
┌─────────────────────────────────────────────────────────────────┐
│ Turn Prompt Assembly                                            │
│                                                                 │
│ 1. Active Channel History (Top Priority)                        │
│    - Recent N messages in the active session.                   │
│    - Guarantees immediate conversational coherence.             │
│                                                                 │
│ 2. 24-Hour Cross-Session Activity (Secondary Priority)          │
│    - Fetched from OpenClaw SQLite session tables.              │
│    - Grouped chronologically into 3 generic categories.         │
│                                                                 │
│ 3. On-Demand Deep History (Fallback Tool)                       │
│    - Older sessions accessible via sessions_history tool        │
│      if the character explicitly realizes they need deeper lore.│
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. The Three Generic Session Categories

Cross-session context must be grouped into strictly three clean, domain-agnostic
categories:

1. **`💭 Inner Thoughts`**: Reflections and solitary ruminations recorded in the
   agent's thought session.
2. **`💬 Direct Chat (#channel)`**: One-on-one dialogues with the user, mentor,
   or specific peers.
3. **`👥 Group Chat (#channel)`**: Multi-user communal channels and team
   discussions.

_(Avoid creating arbitrary sub-categories. Actions and events are naturally
embedded inside thoughts or chats)._

---

## 5. Token Budgeting & Truncation Rules

1. **Fill Upward from Newest to Oldest**: Sort messages chronologically
   ascending, but accumulate messages starting from the most recent until the
   token budget is reached.
2. **Whole Messages Only**: **Never truncate a message mid-sentence or
   mid-word.** If an older message cannot fit entirely within the remaining
   token quota, discard that entire message rather than slicing its text.
3. **Preserve Message Metadata**: Each injected line should include a compact
   timestamp and sender identifier:
   ```text
   [14:25] Alice: I left the documents on the desk.
   [14:26] 💭 Thought: I should double-check the lock before heading out.
   ```
