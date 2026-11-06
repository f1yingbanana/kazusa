# Authentication and permissions

Agreed 2026-11-06. Track implementation and evidence separately in
`apps/kazusa/docs/auth-implementation.md`; a decision here is not proof that it
has shipped.

## Ownership boundary

Keep roles, permission enforcement, the viewer contract, and permission-aware
controls in open-source Kazusa. Keep Supabase authentication, account and world
membership storage, collaborator invitations, billing, and visitor caching/SSE
fan-out in the private OpenRP / Kazusa Cloud wrapper. One UI serves every mode.

The browser uses the Next `/kazusa/*` proxy and the plugin HTTP/SSE read model,
always same-origin. There is no direct browser-to-Gateway transport: no browser
Gateway URL or token, no query-string tokens, and no plugin CORS. Keep the
native OpenClaw Gateway private and its credential server-side; the plugin
accepts only the server's `Authorization: Bearer` header. Reuse the
trusted-proxy principle, not OpenClaw operator scopes as application roles: most
Kazusa routes use `auth: "plugin"`; some need native `auth: "gateway"` caller
authority. Preserve that distinction when consolidating route guards.

## Roles and deployment modes

| Action                                                                    | Owner | Collaborator | Visitor |
| ------------------------------------------------------------------------- | ----- | ------------ | ------- |
| Observe the world's exposed data                                          | Yes   | Yes          | Yes     |
| Chat and move their own player                                            | Yes   | Yes          | No      |
| Edit world/wiki/map, configure models/providers, control time/cast/brains | Yes   | No           | No      |
| Use the system admin agent                                                | Yes   | No           | No      |

Use a small fixed permission map, separate from feature availability
(`capabilities`). Do not add a configurable ACL engine. Collaborator play needs
request-specific player identities before it can be enabled; the demo has no
collaborator accounts.

- `local`: zero-login owner, with the desktop frontend bound to loopback. Keep
  Gateway token authentication even here. Never infer ownership from a request's
  Host, Origin, loopback proxy address, or forwarded headers. The local frontend
  still refuses non-loopback `Host` names (`localhost`, `*.localhost`,
  `127.0.0.1`, `[::1]`) on the page, proxy and host routes, so a DNS-rebound
  name cannot borrow the owner's proxy; that check only rejects, never grants.
- `public`: every browser is a visitor. Operators manage the demo through a
  private path. Keep existing chat reads and the observer feed unfiltered for
  this demo; no chat sends, typing, movement, or other mutations are allowed.
- `trusted-proxy` (later PR): the cloud wrapper authenticates the user, checks
  membership for the destination world, overwrites identity headers, and passes
  a normalized identity/role through an authenticated private connection. A
  dedicated server-to-server secret is sufficient initially. Missing/invalid
  credentials or mode must never fall back to owner. No Supabase SDK, passcode
  login, JWT framework, or provider registry is needed in OSS.

Local mode is a deployment choice, not a security boundary against someone
already holding the private Gateway credential. Do not publish a local-mode
frontend through a tunnel; select public mode explicitly on the public frontend.

## Enforcement

Use one method/path/permission table in `@kazusa/client`, shared by the Next
proxy and plugin route registrar. Unknown routes are denied; adding a route
requires classification. Consolidate messaging's duplicate registrar. Check
authorization before reading bodies, calling services, or starting an SSE
subscription. Authenticate delegated identity before trusting it. Keep native
Gateway authorization on routes that require caller authority.

Prefer native tools over HTTP wrappers for admin diagnostics: an HTTP route that
runs retrieval or embeddings (the removed `memory/preview`) spends provider
quota and must never be `observe`.

Protect all mutations, including send/typing/group membership, movement, clock,
Stop, onstage/offstage, wiki changes, map layout, profile, providers, models,
and context settings. Operational reads also need explicit classification; GET
is not automatically public. Protect `/setup`, `/setup/world`, `/reveal`, and
both methods of `/update` outside the plugin proxy. Desktop setup/reveal/update
are local-owner-only. Hosted frontends never run setup machinery (catalog,
subprocesses, local world config); their readiness comes from the Gateway. The
local page checks only that `world/openclaw.json` exists and enumerates setup
choices only when it renders the guide.

Ordinary character brain traces remain observable. The current native system
agent's trace requires `manage`, because its tool inputs and outputs can contain
administrative secrets. Check this before reading session, transcript, or
failure state, using the authenticated role passed by the shared registrar.

Keep same-origin checks for browser mutations. Deny plugin-authenticated
requests when the service credential is missing. A Gateway-authenticated route
instead relies on the Gateway's native authentication, not a missing-token
bypass masquerading as authentication.

## UI and viewer contract

Expose an uncached `GET /kazusa/access` and `useAccess()`; viewer permissions
must not be embedded into shared cacheable world snapshots. Viewer identity is
distinct from the configured in-world player. Until access is known, mutations
are disabled. The server remains authoritative after UI state becomes stale.

Visitors see a read-only indicator. Disable composers and typing, group and
movement actions, time/cast/Stop controls, map saves, wiki editing, and settings
mutations, including shortcuts and deep links. Gate action hooks as well as
controls. Preserve browsing, search, screenshots, watchlists, and browser-local
preferences. Extend registries and hooks rather than fork the UI.

## Follow-up boundaries

Before collaborators can play, replace configured-player assumptions in chat,
movement, profiles, and SSE with authenticated request identity. Keep canonical
conversation IDs and frozen audiences; do not migrate to invented `dm:*` or
`group:*` session namespaces. Never accept a sender ID from a request body.
Prevent collaborator sends and invitations to the admin agent, including group
and in-person delivery paths. Future DM privacy must cover history, previews,
timeline, and SSE together; hiding a chat row is insufficient.

Scalability is a separate, deferred PR: selected shared visitor snapshots, short
cache lifetimes, request coalescing, and an upstream SSE subscription per world
with edge fan-out and snapshot recovery. Account for periodic snapshot reads and
reconnect bursts, not just SSE connections. Preserve existing asset caching and
pagination; do not implement new caching or a relay in auth PRs.

## Validation

Enumerate mutation routes and prove visitor denial happens before side effects.
Test missing/wrong credentials, spoofed role headers, unknown modes/routes,
same-origin enforcement, standalone setup/update routes, and owner operation.
Verify SSE still connects/reconnects and denies unauthorized subscriptions. Run
plugin and web typechecks and relevant tests. Before calling the demo ready,
exercise both local owner and public visitor in a browser against the backend:
disabled controls produce no writes, manual writes fail, and reads remain live.
Record local tests separately from native Gateway and browser evidence.
