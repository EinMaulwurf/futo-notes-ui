#!/bin/sh
set -eu
minutes="${REMEMBER_BROWSER_MINUTES:-10080}"
case "$minutes" in
  ''|*[!0-9]*|0*) echo 'REMEMBER_BROWSER_MINUTES must be a whole number from 1 to 525600' >&2; exit 1 ;;
esac
if [ "${#minutes}" -gt 6 ] || [ "$minutes" -gt 525600 ]; then
  echo 'REMEMBER_BROWSER_MINUTES must be a whole number from 1 to 525600' >&2
  exit 1
fi
printf '{"rememberBrowserMinutes":%s}\n' "$minutes" > /usr/share/nginx/html/web/config.json
