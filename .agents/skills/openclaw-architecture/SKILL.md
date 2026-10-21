---
name: openclaw-architecture
description:
  "Architecture guidelines for OpenClaw projects: monorepo organization, local
  execution, configuration schemas (openclaw.json), tool policies, and state
  isolation."
---

# OpenClaw Architecture & Project Guidelines

This skill guides the design, setup, and configuration of OpenClaw agent
projects following official best practices.

---

## 1. Engine vs. Project Mental Model

- **The OpenClaw CLI is an engine**, not the project itself.
- Never rely on global installations (`npm i -g openclaw`) in production or
  collaborative codebases. Global installations lead to version drift and
  unmanaged host system services (`~/Library/LaunchAgents`).
- **Always install OpenClaw locally** in the workspace package
  (`apps/kazusa/package.json`) under `dependencies` or `devDependencies`:
  ```json
  "dependencies": {
    "openclaw": "^2026.10.5"
  }
  ```
- **Monorepo Layout**:
  ```text
  kazusa/
  ├── apps/
  │   └── kazusa/                  <-- App package (@openrp-ai/kazusa)
  │       ├── openclaw.json        <-- Gateway & agent configuration
  │       ├── .state/              <-- Local runtime state (GIT-IGNORED)
  │       ├── workspaces/          <-- Agent workspace directories
  │       │   └── main/            <-- Markdown files (SOUL, IDENTITY, USER)
  │       └── package.json         <-- Local npm scripts
  ├── packages/                    <-- Custom shared plugins and libraries
  ├── package.json                 <-- Monorepo root (npm workspaces)
  └── .gitignore
  ```

---

## 2. Configuration & State Isolation

By default, OpenClaw attempts to read and write to the user's home directory
(`~/.openclaw/`). In a managed project, **all state and config must be isolated
locally**:

1. **Environment Variables**:
   - `OPENCLAW_CONFIG_PATH="./openclaw.json"`
   - `OPENCLAW_STATE_DIR="./.state"`
2. **NPM Scripts Pattern** (in `apps/kazusa/package.json`):
   ```json
   "scripts": {
     "openclaw": "OPENCLAW_CONFIG_PATH=./openclaw.json OPENCLAW_STATE_DIR=./.state openclaw",
     "gateway": "OPENCLAW_CONFIG_PATH=./openclaw.json OPENCLAW_STATE_DIR=./.state openclaw gateway",
     "status": "OPENCLAW_CONFIG_PATH=./openclaw.json OPENCLAW_STATE_DIR=./.state openclaw models status",
     "doctor": "OPENCLAW_CONFIG_PATH=./openclaw.json OPENCLAW_STATE_DIR=./.state openclaw doctor"
   }
   ```
3. Root `package.json` proxies these commands:
   ```json
   "scripts": {
     "gateway": "npm run --workspace=@openrp-ai/kazusa gateway",
     "status": "npm run --workspace=@openrp-ai/kazusa status"
   }
   ```

---

## 3. Essential `openclaw.json` Configurations

### Tool Policy & Skill Discovery Quirk

OpenClaw features dynamic tool search compaction (`toolSearch`) enabled by
default. In embedded or headless runtimes, OpenClaw sets
`supportsDeferredToolCalls: false`, which forces tool search into `"tools"`
mode. Under this mode, calling `skills_read` directly is rejected with
`Tool skills_read not found` because it gets hidden behind compaction.

**To enable direct, reliable skill resolution by name (`skills_read`), always
configure**:

```json
"tools": {
  "profile": "full",
  "toolSearch": false,
  "alsoAllow": [
    "skills_read",
    "skills_search"
  ],
  "loopDetection": {
    "enabled": true
  }
}
```

### Clean Loop Detection

Never build manual turn counters or loop limiters into transport plugins. Use
OpenClaw's native `tools.loopDetection` which halts runaway call loops by
monitoring argument frequency and progress.

### Unquoted Frontmatter in `IDENTITY.md`

OpenClaw parses identity headers with a simple line-based regex. Wrapping names
in quotes (e.g. `name: "Alice"`) causes literal escaped quotes to display in UIs
(`"\"Alice\""`). **Always use unquoted strings**:

```markdown
name: Alice
```

---

## 4. Git Hygiene & Submodule Prevention

1. **Remove Nested `.git` in Workspaces**: OpenClaw's bootstrap initializes a
   git repository inside newly scaffolded workspaces
   (`workspaces/<agent>/.git`). In a parent git monorepo, this registers as an
   untracked gitlink/submodule. **Always remove `workspaces/<agent>/.git`** so
   the monorepo root tracks agent markdown files directly.
2. **Strictly Ignore Runtime Artifacts**: Never commit `.state/`, `.env`,
   `*.sqlite*`, `*.sqlite-wal`, or backup files (`openclaw.json.bak`).
3. **Track Template Files**: Maintain a tracked `.env.example` documenting all
   required provider keys and configuration paths.
