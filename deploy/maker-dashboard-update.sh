#!/usr/bin/env bash
# Pull the latest maker-dashboard image, verify its cosign signature was
# produced by the upstream GitHub Actions workflow, and restart the service
# only if the image digest actually changed. Bails out without restarting
# if signature verification fails.
set -euo pipefail

# Serialize concurrent runs: the ntfy listener and the fallback timer can
# both fire close together. The second caller exits cleanly instead of
# racing a docker pull / restart against the first.
exec 9>/run/lock/maker-dashboard-update.lock
flock -n 9 || {
	echo "[update] another run in progress, skipping"
	exit 0
}

IMAGE="${IMAGE:-docker.io/coinswap/maker-dashboard:master}"
REPO="${REPO:-citadel-tech/maker-dashboard}"
WORKFLOW_PATH="${WORKFLOW_PATH:-.github/workflows/docker-publish.yml}"
BRANCH="${BRANCH:-main}"
SERVICE="${SERVICE:-maker-dashboard.service}"

CERT_IDENTITY="${CERT_IDENTITY:-https://github.com/${REPO}/${WORKFLOW_PATH}@refs/heads/${BRANCH}}"
CERT_OIDC_ISSUER="${CERT_OIDC_ISSUER:-https://token.actions.githubusercontent.com}"

HOST="$(hostname)"
TAG="<strong>[maker-dashboard]</strong>"

current_digest() {
	docker image inspect --format '{{index .RepoDigests 0}}' "$IMAGE" 2>/dev/null |
		awk -F'@' '{print $2}' || true
}

log() { printf '[update] %s\n' "$*"; }

# Optional Matrix notifier. Fires only if matrix-commander is installed and
# setup.sh has written credentials. Notification failures never block the
# deploy.
# Usage: notify "<plain body>" [<html body>]
notify() {
	command -v matrix-commander >/dev/null || return 0
	command -v notify-matrix.sh >/dev/null || return 0
	[ -r "/etc/maker-dashboard/matrix-commander/credentials.json" ] || return 0
	notify-matrix.sh "$1" "${2:-}" 2>/dev/null || true
}

# Convenience: red bold label for failure events.
fail_label() { printf '<font color="#cc0000"><strong>%s</strong></font>' "$1"; }

before="$(current_digest)"
log "current digest: ${before:-<none>}"

log "pulling $IMAGE"
docker pull --quiet "$IMAGE" >/dev/null

after="$(current_digest)"
log "pulled digest:  ${after:-<none>}"

if [ -z "$after" ]; then
	log "ERROR: could not resolve pulled digest"
	notify \
		"[maker-dashboard] ERROR on ${HOST}: could not resolve pulled digest for ${IMAGE}" \
		"${TAG} $(fail_label "ERROR") on <code>${HOST}</code><br/>Could not resolve pulled digest for <code>${IMAGE}</code>"
	exit 1
fi

# Always verify, even if the digest didn't change, protects against a
# registry that swaps content under a tag without bumping our local cache.
log "verifying signature against ${CERT_IDENTITY}"
if ! cosign verify \
	--certificate-identity "$CERT_IDENTITY" \
	--certificate-oidc-issuer "$CERT_OIDC_ISSUER" \
	"${IMAGE%:*}@${after}" >/dev/null; then
	log "ERROR: signature verification FAILED: refusing to deploy"
	notify \
		"[maker-dashboard] SIGNATURE FAILED on ${HOST}: refusing to deploy ${after}" \
		"${TAG} $(fail_label "SIGNATURE VERIFICATION FAILED") on <code>${HOST}</code><br/>Image: <code>${after}</code><br/>Action: refused to deploy"
	exit 1
fi
log "signature OK"

if [ "$before" = "$after" ]; then
	log "no change, nothing to do"
	exit 0
fi

short="${after#sha256:}"
short="${short:0:12}"
before_short="${before#sha256:}"
before_short="${before_short:0:12}"
[ -n "$before_short" ] || before_short="<none>"

log "digest changed, restarting ${SERVICE}"
notify \
	"[maker-dashboard] Deploying on ${HOST}: ${before_short} -> ${short}" \
	"${TAG} Deploying on <code>${HOST}</code><br/>From: <code>${before_short}</code><br/>To: <code>${short}</code>"

if systemctl restart "$SERVICE"; then
	log "done"
	notify \
		"[maker-dashboard] Deployed ${short} on ${HOST}" \
		"${TAG} <strong>Deployed</strong> on <code>${HOST}</code><br/>Image: <code>${short}</code>"
else
	notify \
		"[maker-dashboard] RESTART FAILED on ${HOST} for ${short}" \
		"${TAG} $(fail_label "RESTART FAILED") on <code>${HOST}</code><br/>Image: <code>${short}</code><br/>systemctl restart ${SERVICE} did not exit cleanly"
	exit 1
fi
