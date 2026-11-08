# Frontend end-to-end tests

These Playwright tests exercise the real Next.js app, its proxy, and the Kazusa
Gateway. Use a configured local world with characters, an existing direct chat,
and at least one World Wiki page. Setup must be complete and owner controls must
be available.

From the repository root, start the stack:

```sh
npm run dev
```

Then run the suite in another terminal:

```sh
npm run --workspace=@kazusa/web test:e2e
```

Playwright reuses the stack at `http://127.0.0.1:3000` during local runs. If it
is not running, the test configuration starts `npm run dev` automatically and
waits for `/kazusa/world`.

The default browser is installed Google Chrome. To use Playwright's Chromium,
install it once and select its channel:

```sh
npm exec --workspace=@kazusa/web -- playwright install chromium
PLAYWRIGHT_CHANNEL=chromium npm run --workspace=@kazusa/web test:e2e
```

The suite checks desktop and mobile navigation, roster selection, persisted
watchlists and preference updates across two tabs, SWR resource reuse, actual
chat history, and offline/reconnect behavior. It edits a wiki draft locally and
cancels it; it does not send messages or save backend changes. Browser runtime
errors fail the tests. Failure screenshots and traces are written to
`apps/web/test-results/`.
