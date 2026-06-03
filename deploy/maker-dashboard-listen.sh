#!/usr/bin/env bash
# Subscribe to an ntfy topic and run the update script on each message.
# This is the fast path: CI publishes to the topic after build+sign, and
# this listener triggers a pull/verify/restart within seconds. The systemd
# timer remains as a fallback for any missed message.
#
# Only an outbound HTTPS connection is made; nothing listens for inbound
# traffic. A spurious message can at worst trigger a harmless re-check,
# since update.sh still verifies the cosign signature before deploying.
#
# Required env (usually from /etc/maker-dashboard/ntfy.env):
#   NTFY_TOPIC   the topic to subscribe to
# Optional:
#   NTFY_URL     ntfy server (default https://ntfy.sh)
#   UPDATE_CMD   command to run on trigger (default maker-dashboard-update.sh)
set -uo pipefail

NTFY_URL="${NTFY_URL:-https://ntfy.sh}"
NTFY_TOPIC="${NTFY_TOPIC:?NTFY_TOPIC required}"
UPDATE_CMD="${UPDATE_CMD:-/usr/local/bin/maker-dashboard-update.sh}"

if ! command -v curl >/dev/null; then
    echo "[listen] ERROR: curl not found in PATH" >&2
    exit 1
fi

log() { printf '[listen] %s\n' "$*"; }

log "subscribing to ${NTFY_URL}/${NTFY_TOPIC}"

while true; do
	# --raw streams one message body per line; keepalives arrive as blank lines.
	curl -sN "${NTFY_URL}/${NTFY_TOPIC}/raw" | while IFS= read -r line; do
		[ -z "$line" ] && continue
		log "trigger: ${line}"
		"$UPDATE_CMD" || log "update failed; will retry on next trigger or timer"
	done
	log "stream closed, reconnecting in 5s"
	sleep 5
done
