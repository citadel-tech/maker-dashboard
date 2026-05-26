#!/usr/bin/env bash
# Post a message to a Matrix room via matrix-commander (E2EE-capable).
# Usage: notify-matrix.sh "<plain body>" [<html body>]
#
# Requires matrix-commander installed and logged in by setup.sh, which
# leaves credentials at:
#   /etc/maker-dashboard/matrix-commander/credentials.json
#   /etc/maker-dashboard/matrix-commander/store/
#
# Override the paths with MATRIX_COMMANDER_CREDS / MATRIX_COMMANDER_STORE.
set -euo pipefail

plain="${1:?message required}"
html="${2:-}"

CREDS="${MATRIX_COMMANDER_CREDS:-/etc/maker-dashboard/matrix-commander/credentials.json}"
STORE="${MATRIX_COMMANDER_STORE:-/etc/maker-dashboard/matrix-commander/store}"

if [ ! -r "$CREDS" ]; then
	echo "ERROR: ${CREDS} not found. Run setup.sh to configure Matrix." >&2
	exit 1
fi

if ! command -v matrix-commander >/dev/null; then
	echo "ERROR: matrix-commander not in PATH. Run setup.sh to install it." >&2
	exit 1
fi

if [ -n "$html" ]; then
	matrix-commander -c "$CREDS" -s "$STORE" --html -m "$html" >/dev/null
else
	matrix-commander -c "$CREDS" -s "$STORE" -m "$plain" >/dev/null
fi
