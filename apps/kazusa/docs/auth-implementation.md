# Auth implementation tracker

Design: [Kazusa auth skill](../../../.agents/skills/kazusa/references/auth.md).
Agreed 2026-11-06. Each PR should work with all previous PRs applied. Do not
publish the demo until PRs 1 and 2 pass their acceptance checks.

## PR 1 — Server access enforcement (implemented; ready for review)

Local play remains owner without a login. Public mode serves the existing
observer data and rejects writes before they reach services.

- [x] Record architecture, role semantics, and OSS/cloud ownership in skills.
- [x] Divide implementation into independently reviewable PRs.
- [x] Add role/viewer/permission schemas and an explicit shared route policy.
- [x] Resolve local/public access server-side; reject unknown modes.
- [x] Add uncached `/kazusa/access`, separate from world data.
- [x] Enforce permissions at Next and plugin boundaries; consolidate messaging.
- [x] Fail closed on missing plugin service credentials; preserve Gateway auth.
- [x] Protect setup/download/reveal/update routes and hosted setup rendering.
- [x] Test route coverage, denied side effects, spoofing, SSE and local
      behavior.
- [x] Run relevant tests, plugin/web typechecks, formatting and lint.
- [x] Record validation evidence and prepare PR.

Review follow-ups (folded into PR 1):

- [x] Delete the `memory/preview` and `knowledge/explain` HTTP wrappers. Preview
      embedded caller text (paid quota) under `observe`; neither had a browser
      consumer, and the native `memory_preview`/`knowledge_explain` tools stay.
- [x] System agent brain trace requires `manage` (already in this PR; tests in
      `perception/brain-trace-http.test.ts`).
- [x] Local mode refuses non-loopback `Host` names on the page, proxy and host
      routes (DNS rebinding). Ownership still comes only from the mode.
- [x] Hosted pages never run setup machinery; the local page checks only the
      config file and enumerates the catalog only to render the guide.
- [x] Delete the direct browser-to-Gateway transport: browser URL/token,
      `NEXT_PUBLIC_KAZUSA_*`, stored credentials (purged from localStorage), the
      connection form, token-bearing fetchers/SSE URLs, plugin query-token auth
      and plugin CORS/preflight. Server Bearer auth and native Gateway auth are
      unchanged.

## PR 2 — Read-only demo UI (implemented; ready for review)

Deployable demo milestone, depending on PR 1.

- [x] Add `useAccess()` with mutations disabled while loading/on failure.
- [x] Add read-only indicator and gate controls through existing registries.
- [x] Disable chat composers/typing/groups/movement and mutation action hooks.
- [x] Disable clock, Stop, stage, wiki/map editing, and configuration controls.
- [x] Keep observation, local preferences, search and screenshots working.
- [x] Fix direct-link/shortcut paths and avoid unauthorized background fetches.
- [x] Keep hosted browser transport same-origin with no Gateway credential (done
      in PR 1's review follow-ups).
- [x] Gate operational reads by permission as well as capability (e.g.
      `useModels()` still requests owner-only routes for visitors).
- [x] Verify local-owner/public-visitor behavior in browser and direct requests.

## PR 3 — Trusted-proxy adapter (implemented; ready for review)

One UI behind the private wrapper. Collaborator interaction stays disabled until
PR 4; no accounts, invitations or Supabase implementation in this repo.

- [x] Authenticate the wrapper connection; normalize viewer identity and role.
- [x] Require world-specific membership upstream and a non-bypassable origin.
- [x] Reject spoofed/duplicate identity headers and invalid configuration.
- [x] Cover both HTTP and SSE, including identity changes and revoked access.
- [x] Key desktop `/update` polling to loopback local mode rather than solely
      owner role so cloud wrapper owners do not hit 403s.
- [x] Verify end-to-end through a small test proxy; document deployment.

## PR 4 — Collaborator player identities

- [ ] Bind authenticated subjects to stable world-local player identities.
- [ ] Make messaging, movement, profiles, roster and SSE request-specific.
- [ ] Preserve audience membership/history rules and canonical chat IDs.
- [ ] Prevent collaborators using the admin agent through any delivery path.
- [ ] Define and implement private-chat visibility across every read surface
      before enabling private conversations; demo filtering remains out of
      scope.
- [ ] Test two players for sender spoofing, state separation and SSE isolation.
- [ ] Cloud-only follow-up: Supabase membership and invitations in OpenRP.

## PR 5 — Visitor scaling (deferred; do not implement in auth work)

- [ ] Measure snapshot reads, SSE connections and reconnect bursts.
- [ ] Cloud-only: selected public snapshot caching and request coalescing.
- [ ] Cloud-only: one upstream SSE feed per world, edge fan-out, recovery.
- [ ] Separate private responses/access metadata from shared cache entries.
- [ ] Load-test limits; do not claim unlimited origin capacity.

## Evidence

PR 1 branch: `codex/auth-server-access`.

- Focused tests: **19 files, 92 tests passed**, covering the changed handlers,
  auth policy, messaging side effects, and Next proxy/host routes.
- `npm run typecheck`, web `tsc --noEmit --incremental false`, and client
  package `tsc --noEmit`: passed. The zero-build client module uses its real
  `.ts` extension; web/client compiler options allow this with `noEmit`.
- Targeted ESLint and Prettier checks: passed.
- Real HTTP against Next 16.4.3 (webpack), in an isolated temporary checkout
  with a dummy credential: `/kazusa/access` returns visitor and `no-store`;
  seven POST routes plus updater GET return 403 despite a forged owner header.
  The first smoke check caught a `.js`-to-`.ts` resolution failure; corrected
  the imports and repeated successfully. No live world was modified.
- Full suite: **1,148 passed, 7 failed**. All seven failures also reproduced
  against an unchanged HEAD snapshot with the same dependencies/world fixtures:
  two world-map fixture failures, four filesystem watcher timeouts, and the
  deleted-place trip settlement test. They are outside this PR.
- Native Gateway restart and browser control acceptance are not claimed here. PR
  2 must verify the real Gateway and UI before publishing the demo.

### Running the server modes

The desktop launcher still binds Next to loopback. Unset `KAZUSA_AUTH_MODE` or
set it to `local` for normal owner play.

Set `KAZUSA_AUTH_MODE=public` on the public frontend for read-only demo mode; it
strips incoming identity, forwards its own visitor role, and refuses all
mutation/operational routes before forwarding. The plugin also enforces that
role after authenticating the private service token. Set the Gateway process to
`public` as well when all its Kazusa HTTP callers must be read-only (even a
bearer-token caller asserting owner).

Set `KAZUSA_AUTH_MODE=trusted-proxy` on hosted instances behind an upstream
wrapper (such as OpenRP Cloud). In this mode:

- Both Next and the Gateway should run with `KAZUSA_AUTH_MODE=trusted-proxy`
  (never run Gateway in `public` mode if owner operations are needed, as
  `public` clamps all callers to visitor).
- The upstream wrapper must supply `x-kazusa-proxy-secret` matching
  `KAZUSA_TRUSTED_PROXY_SECRET`. Each world instance must be provisioned with
  its own unique proxy secret.
- The wrapper must always supply `x-kazusa-role: owner` or
  `x-kazusa-role: visitor`. Missing roles are rejected with 401.
- Optionally configure `KAZUSA_WORLD_ID` and have the wrapper pass
  `x-kazusa-world-id` to cryptographically enforce instance binding.
- Configure `KAZUSA_PUBLIC_ORIGIN` (or pass `x-forwarded-host`) to ensure
  browser CSRF/same-origin checks pass when proxying to internal addresses.
- Long-lived SSE streams (`/kazusa/events`) remain open until closed by the
  client or terminated by the upstream wrapper upon access revocation.
- Unknown modes fail closed (503).

Both Next and the Gateway still need the server-only Gateway credential. Do not
publish a local-mode frontend or distribute that credential to visitors. PR 1
deliberately leaves the existing UI controls visible; they receive 403 in public
mode until PR 2 adds the read-only presentation.

PR 2 branch: `codex/auth-readonly-ui`.

### PR 2 Evidence

- **useAccess fail-closed contract**:
  - `apps/web/hooks/use-access.ts` fetches `/kazusa/access` via SWR without
    caching and validates responses with `AccessSchema.parse()`.
  - While loading or on error before access is first known, falls back to
    `accessForRole("visitor")`, ensuring mutations are disabled before the
    server responds.
  - When access is already known, retains the last good state on revalidation
    error so temporary disconnections do not close the owner's active wiki
    editor or discard unsaved text.
  - Collaborator role marks `isReadOnly: false` (`!canPlay`), allowing
    interaction without displaying the "View only" badge.
  - Comprehensive unit test suite in `apps/web/hooks/use-access.test.ts` (7
    tests passing: loading fail-closed, error fail-closed before known, retains
    access across revalidation errors, validates schema, visitor read-only,
    collaborator play-only, owner full access).
- **Registry and component gating**:
  - `StageView`, `InspectorSection`, `SettingsCategory`, and `StatusItem` in
    `apps/web/lib/registry/types.ts` extended with
    `requiresPermission?: Permission`.
  - Sensitive inspector sections (`character.model`, `character.context`) gated
    with `requiresPermission: "manage"`.
  - Administrative settings categories (`models`, `context`, `usage`, `updates`)
    gated with `"manage"`; `profile` category gated with `"play"`.
  - `StatusItem` update check gated with `"manage"`; `read-only` indicator badge
    registered at order 5 in `apps/web/lib/registry/status.ts` (hidden while
    access is loading to prevent flash).
  - Registries tested in `apps/web/lib/registry/permissions.test.ts` (4 tests
    passing).
  - Strongly typed `SETTINGS_CATEGORIES` and `INSPECTOR_SECTIONS` without unsafe
    type assertions (`as`).
- **Control presentation**:
  - Treated as standard production permissions: controls lacking permission are
    simply disabled cleanly without patronizing "read-only demo" tooltips.
    - Speed presets & Pause in `TopBar`: disabled when not live/manageable.
    - Character Stop button: disabled when `!canManage`.
    - Place map "Arrange" button: disabled when `!canManage`.
    - Wiki "New page", "Edit", and "Write what they make of it" buttons:
      disabled when `!canManage`.
    - Chat composer: disabled textarea, buttons, and radio group for visitors.
    - Chat header and summary: "New group", "Add people", "Talk in person",
      "Leave conversation/group", and character row removal disabled/hidden for
      visitors.
    - Place header: "Go here" stays hidden when location is not live, and is
      disabled when live but player lacks movement permission.
    - Character header: "Go there" button disabled when player lacks movement
      permission.
    - Profile settings: form wrapped in `<fieldset disabled={!canPlay}>` to
      cleanly disable inputs and buttons without per-field boilerplate.
    - Status bar: displays an unobtrusive "View only" badge for visitors.
- **Deep links & direct-link protection**:
  - `?view=wiki&wiki.edit=...`: editing state cleared for visitors; renders
    read-only page.
  - `?view=settings&settings.tab=models`: falls back to `connection` when
    lacking permission.
  - `?chats.dm=...` and `?chats.talk=...`: waits while access resolves before
    evaluating, preventing owner deep links from being dropped on initial page
    load; direct conversation drafts are not created for visitors.
- **Operational read gating**:
  - SWR hooks for admin-only data (`useModels`, `useProvidersResource`,
    `useRole`, `useContextSettings`, `useUsage`, `useUpdate`,
    `useAnnouncedRelease`) pass `null` as their cache key when `!canManage` or
    `!isOwner`, avoiding 403 HTTP requests.
  - System agent brain trace (`useBrainTrace`) gated to require `canManage`,
    while standard agent traces remain public under `observe`.
- **Validation**:
  - `npm run typecheck`, web `tsc --noEmit`, and client package `tsc --noEmit`:
    all passed with 0 errors.
  - Web & client tests: 27 test files, 171 tests passed.
  - Monorepo full test suite: 115 test files, 1,181 tests passed.
  - Linting (`npx eslint apps/web packages/client`) and formatting
    (`pretty-quick`) passed.

PR 3 branch: `codex/auth-trusted-proxy`.

### PR 3 Evidence

- **Wrapper connection authentication & anti-spoofing**:
  - `KAZUSA_AUTH_MODE=trusted-proxy` mode added to `@kazusa/client`.
  - Timing-safe comparison of `KAZUSA_TRUSTED_PROXY_SECRET` strictly via
    `x-kazusa-proxy-secret`.
  - Rejects unauthenticated direct requests (401), missing server secret (503),
    missing or dropped role headers (401), duplicate/array role headers (401),
    and unsupported roles (401).
  - Optional `KAZUSA_WORLD_ID` instance binding verifies `x-kazusa-world-id`,
    rejecting requests routed to the wrong world container (401).
  - Unauthenticated requests cannot bypass the wrapper origin or spoof owner
    authority.
- **Normalization of viewer identity & access**:
  - Validated role mapped to `accessForRole(role, { local: false })`.
  - Forwarded to OpenClaw Gateway with authenticated service bearer token and
    normalized `x-kazusa-role`.
- **Public origin and same-origin CSRF**:
  - `isSameOrigin` supports `KAZUSA_PUBLIC_ORIGIN` and `x-forwarded-host`,
    ensuring reverse-proxied browser requests with public `Origin` and internal
    container `Host` are cleanly verified.
- **Desktop /update loopback keying & host isolation**:
  - `AccessSchema` extended with `local: z.boolean().optional()`.
  - `useAccess()` returns `isLocal: boolean`.
  - `useUpdate()` and `useAnnouncedRelease()` key polling on
    `isOwner && isLocal ? UPDATE_KEY : null`.
  - Settings `updates` category and status bar item gated with
    `requiresLocal: true`.
  - Settings `ConfigFiles` button calling `/reveal` gated to local owner only.
  - Desktop-only host routes (`/update`, `/setup`, `/setup/world`, `/reveal`)
    reject non-local requests (403) before processing.
- **End-to-end integration & verification**:
  - End-to-end wrapper integration test suite in
    `apps/web/lib/auth/trusted-proxy.test.ts` (8 tests passing: owner mutation
    forwarding with internal host / public origin, visitor read/write
    boundaries, dropped role failure, world ID mismatch rejection, direct bypass
    prevention, SSE event streaming with cancellation signal, host route
    isolation, and a live Node `http.Server` reverse proxy over TCP sockets).
  - Proxy unit tests in `apps/web/lib/auth/proxy.test.ts` (12 tests passing).
  - Gateway registrar tests in
    `apps/kazusa/plugins/kazusa/src/http/access.test.ts` (10 tests passing).
  - Full suite: all 116 test files pass.
