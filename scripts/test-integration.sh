#!/bin/sh
set -eu
name="futo-notes-test-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT INT TERM
# Disposable server, isolated from the deployed vault and without persistent volumes.
docker run -d --name "$name" --tmpfs /data -p 127.0.0.1:13005:3000 \
  -e FUTO_NOTES_PASSWORD=integration-test-only-not-a-real-secret \
  -e REMEMBER_BROWSER_MINUTES=2 \
  "${TEST_SYNC_IMAGE:-futo_notes-sync:local}" >/dev/null
for attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:13005/health >/dev/null 2>&1; then break; fi
  sleep 1
done
TEST_CONTAINER_NAME="$name" TEST_SYNC_URL=http://127.0.0.1:13005 npm test
