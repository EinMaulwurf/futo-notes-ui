# FUTO Notes + browser client

Personal Docker stack: the FUTO v0.7.1 encrypted sync server with a small configurable-session patch and a full browser client using FUTO's editor. Browser host and image integration are modified; FUTO editing behavior and license notices are retained. Upstream editor revision is pinned in `Dockerfile`.

- Browser: **https://futo-notes.maulwurf.fun/web/**
- Android server URL: **https://futo-notes.maulwurf.fun**
- Both use the same sync password. No additional Caddy/OAuth login.

Initialize a **new** vault with `python3 scripts/setup-password.py`, save `.sync-password` in your password manager and delete that file. Then run `docker compose up -d --build`. Existing credentials must not be changed without rewrapping the vault key. Secrets, runtime data and browser caches are ignored by Git.

The server persists encrypted blobs and SQLite in `./data`. The web app keeps an encrypted offline cache, saves durable pending edits, preserves conflicts, supports folders/tags/search, images, Markdown/ZIP import/export, dark mode and locking. The password stays in memory. The optional **Remember this browser** checkbox saves a non-extractable vault key locally until expiry; Lock clears it and ends the server session. Without it, the 15-minute idle lock remains active. Browser storage must be available; exports are plaintext. Only the self-hosted password vault is supported.

`REMEMBER_BROWSER_MINUTES=10080` in `.env` sets remembered unlocks and new server sessions to seven days (whole minutes, 1–525600). Apply duration changes with `docker compose up -d`. Shorter settings cap existing remembered unlocks on the next page load; longer settings require signing in again. Existing server sessions retain their original deadline. Cached notes remain encrypted after expiry.

The repository license covers our browser client and integration code. Bundled FUTO editor/server code retains its own Source First licenses; the pinned server source is modified only for session lifetime configuration.

Validation: `npm ci && npm run check && npm run build`; `scripts/test-integration.sh` tests against a disposable FUTO server. Build both images first. Browser checks: install Chromium with `npx playwright install chromium`, then run `scripts/test-browser.sh` against its disposable stack, never your live notes. Caddy snippet: `deploy/caddy.caddyfile`.
