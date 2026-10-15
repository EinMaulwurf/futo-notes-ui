#!/bin/sh
set -eu
stack=futo-notes-browser-qa
trap 'docker compose -p "$stack" -f deploy/compose.test.yaml down >/dev/null 2>&1 || true' EXIT INT TERM
REMEMBER_BROWSER_MINUTES=2 docker compose -p "$stack" -f deploy/compose.test.yaml up -d
# Restart the disposable server between cases to reset vaults and login limits.
# Install Chromium first with: npx playwright install chromium
for scenario in 'password, full editing' 'offline edits' 'mobile layout' 'imports Markdown' 'preserves typing' 'remember browser'; do
  docker compose -p "$stack" -f deploy/compose.test.yaml restart sync >/dev/null
  for attempt in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:13006/health >/dev/null 2>&1; then break; fi
    sleep 1
  done
  if test -n "${TEST_BROWSER_RUNNER_IMAGE:-}"; then
    docker run --rm --network host --shm-size=1g -v "$PWD:/work" -w /work \
      -e PLAYWRIGHT_BROWSERS_PATH=/work/.playwright "$TEST_BROWSER_RUNNER_IMAGE" \
      npx playwright test --grep "$scenario"
  else
    npx playwright test --grep "$scenario"
  fi
done
