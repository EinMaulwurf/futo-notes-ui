# FUTO Notes + browser client

Personal Docker stack: the official encrypted sync server and a full browser client using FUTO's editor. Browser host and image integration are modified; FUTO editing behavior and license notices are retained. Upstream editor revision is pinned in `Dockerfile`.

- Browser: **https://futo-notes.maulwurf.fun/web/**
- Android server URL: **https://futo-notes.maulwurf.fun**
- Both use the same sync password. No additional Caddy/OAuth login.

Initialize a **new** vault with `python3 scripts/setup-password.py`, save `.sync-password` in your password manager and delete that file. Then run `docker compose up -d --build`. Existing credentials must not be changed without rewrapping the vault key. Secrets, runtime data and browser caches are ignored by Git.

The server persists encrypted blobs and SQLite in `./data`. The web app keeps an encrypted offline cache, saves durable pending edits, preserves conflicts, supports folders/tags/search, images, Markdown/ZIP import/export, dark mode and locking. Password and unlocked vault key stay in memory. Browser storage must be available; exports are plaintext. Only the self-hosted password vault is supported.

Validation: `npm ci && npm run check && npm run build`; `scripts/test-integration.sh` tests against a disposable official server. Browser tests use `TEST_WEB_URL` and `TEST_PASSWORD` against a disposable deployment, never your live notes. Caddy snippet: `deploy/caddy.caddyfile`.
