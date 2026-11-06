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

## PR 2 — Read-only demo UI

Deployable demo milestone, depending on PR 1.

- [ ] Add `useAccess()` with mutations disabled while loading/on failure.
- [ ] Add read-only indicator and gate controls through existing registries.
- [ ] Disable chat composers/typing/groups/movement and mutation action hooks.
- [ ] Disable clock, Stop, stage, wiki/map editing, and configuration controls.
- [ ] Keep observation, local preferences, search and screenshots working.
- [ ] Fix direct-link/shortcut paths and avoid unauthorized background fetches.
- [x] Keep hosted browser transport same-origin with no Gateway credential (done
      in PR 1's review follow-ups).
- [ ] Gate operational reads by permission as well as capability (e.g.
      `useModels()` still requests owner-only routes for visitors).
- [ ] Verify local-owner/public-visitor behavior in browser and direct requests.

## PR 3 — Trusted-proxy adapter

One UI behind the private wrapper. Collaborator interaction stays disabled until
PR 4; no accounts, invitations or Supabase implementation in this repo.

- [ ] Authenticate the wrapper connection; normalize viewer identity and role.
- [ ] Require world-specific membership upstream and a non-bypassable origin.
- [ ] Reject spoofed/duplicate identity headers and invalid configuration.
- [ ] Cover both HTTP and SSE, including identity changes and revoked access.
- [ ] Verify end-to-end through a small test proxy; document deployment.

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
set it to `local` for normal owner play. Set `KAZUSA_AUTH_MODE=public` on the
public frontend; it strips incoming identity, forwards its own visitor role, and
refuses all mutation/operational routes before forwarding. The upgraded plugin
also enforces that role after authenticating the private service token. Set the
Gateway process to `public` as well when all its Kazusa HTTP callers must be
read-only (even a bearer-token caller asserting owner). A separate private
local-mode frontend can only manage a Gateway running in local mode. Keep the
Gateway port private in either case. Restart each process after changing its
mode. Unknown modes, including the not-yet-implemented `trusted-proxy`, fail
closed.

Both Next and the Gateway still need the server-only Gateway credential. Do not
publish a local-mode frontend or distribute that credential to visitors. PR 1
deliberately leaves the existing UI controls visible; they receive 403 in public
mode until PR 2 adds the read-only presentation.
