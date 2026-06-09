#!/usr/bin/env bash
# Interactive one-shot setup for Maker Dashboard on a Linux VPS.
# Installs cosign, deploy scripts, and the systemd unit; pulls and verifies
# the image; enables the service. Optionally configures Matrix notifications.
#
# Run as root from a clone of the repo:
#   sudo deploy/setup.sh

set -euo pipefail

IMAGE_NAME="docker.io/coinswap/maker-dashboard"
REPO="citadel-tech/maker-dashboard"
WORKFLOW_PATH=".github/workflows/docker-publish.yml"
BRANCH="main"
DATA_DIR="/var/lib/maker-dashboard"
WALLET_DIR="/var/lib/maker-dashboard-coinswap"
MC_DIR="/etc/maker-dashboard/matrix-commander"
MC_CREDS="${MC_DIR}/credentials.json"
MC_STORE="${MC_DIR}/store"
MC_VENV="/opt/maker-dashboard/matrix-commander-venv"

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '  \033[33m%s\033[0m\n' "$*"; }
fatal() {
	printf '\033[31mERROR:\033[0m %s\n' "$*" >&2
	exit 1
}

# Install the system packages matrix-commander / matrix-nio[e2e] needs:
# python3 + venv + dev headers, libolm dev headers, a C toolchain.
# Package names vary per distro.
install_matrix_deps() {
	if command -v apt-get >/dev/null; then
		apt-get update -qq
		apt-get install -y --no-install-recommends \
			python3 python3-venv python3-dev libolm-dev build-essential
	elif command -v dnf >/dev/null; then
		dnf install -y python3 python3-devel libolm-devel gcc make
	elif command -v yum >/dev/null; then
		yum install -y python3 python3-devel libolm-devel gcc make
	elif command -v pacman >/dev/null; then
		pacman -Sy --noconfirm --needed python libolm base-devel
	elif command -v zypper >/dev/null; then
		zypper install -y python3 python3-devel libolm-devel gcc make
	elif command -v apk >/dev/null; then
		apk add --no-cache python3 python3-dev py3-pip olm-dev gcc musl-dev make
	else
		warn "No supported package manager detected."
		warn "Install these packages manually before continuing:"
		warn "  - Python 3 with venv module"
		warn "  - Python 3 development headers"
		warn "  - libolm development headers"
		warn "  - C compiler + make"
		read -r -p "  Press ENTER once done, or Ctrl-C to abort: " _
	fi
}

# ---------------------------------------------------------------- sanity ----

[ "$(id -u)" -eq 0 ] || fatal "must run as root (use sudo)"

for f in maker-dashboard-update.sh maker-dashboard-listen.sh \
	maker-dashboard-forwarder.py notify-matrix.sh \
	maker-dashboard.service maker-dashboard-update.service \
	maker-dashboard-update.timer maker-dashboard-listener.service \
	maker-dashboard-forwarder.service; do
	[ -f "${DEPLOY_DIR}/${f}" ] || fatal "${DEPLOY_DIR}/${f} not found"
done

command -v docker >/dev/null || fatal "docker not installed"
command -v systemctl >/dev/null || fatal "systemd not detected"
command -v curl >/dev/null || fatal "curl not installed"

# ---------------------------------------------------------------- cosign ----

bold "1. cosign"
if command -v cosign >/dev/null; then
	info "already installed: $(cosign version 2>&1 | head -1)"
else
	info "downloading latest release..."
	tmpfile="$(mktemp)"
	trap 'rm -f "$tmpfile"' EXIT
	curl -sSL -o "$tmpfile" \
		https://github.com/sigstore/cosign/releases/latest/download/cosign-linux-amd64

	curl -sSL -o "${tmpfile}.sha256" \
		https://github.com/sigstore/cosign/releases/latest/download/cosign-linux-amd64.sha256

	# Verify checksum
	echo "$(cat "${tmpfile}.sha256")  ${tmpfile}" | sha256sum -c - || fatal "cosign checksum verification failed"

	install -m 0755 "$tmpfile" /usr/local/bin/cosign
	rm -f "$tmpfile"
	trap - EXIT
	info "installed: $(cosign version 2>&1 | head -1)"
fi

# ---------------------------------------------------- deploy artifacts ----

bold "2. Deploy scripts and systemd units"
install -m 0755 "${DEPLOY_DIR}/maker-dashboard-update.sh" /usr/local/bin/
install -m 0755 "${DEPLOY_DIR}/maker-dashboard-listen.sh" /usr/local/bin/
install -m 0755 "${DEPLOY_DIR}/maker-dashboard-forwarder.py" /usr/local/bin/
install -m 0755 "${DEPLOY_DIR}/notify-matrix.sh" /usr/local/bin/
install -m 0644 "${DEPLOY_DIR}/maker-dashboard.service" /etc/systemd/system/
install -m 0644 "${DEPLOY_DIR}/maker-dashboard-update.service" /etc/systemd/system/
install -m 0644 "${DEPLOY_DIR}/maker-dashboard-update.timer" /etc/systemd/system/
install -m 0644 "${DEPLOY_DIR}/maker-dashboard-listener.service" /etc/systemd/system/
install -m 0644 "${DEPLOY_DIR}/maker-dashboard-forwarder.service" /etc/systemd/system/
info "scripts in /usr/local/bin/, units in /etc/systemd/system/"

# ---------------------------------------------------------- data dir ----

bold "3. Data directories"
# Dashboard config (auth.json + encrypted makers.json).
mkdir -p "$DATA_DIR"
chown 1000:1000 "$DATA_DIR"
info "${DATA_DIR} -> ~/.config/maker-dashboard (auth + maker configs)"
# Maker wallets, fidelity bonds, swap history, per-maker Tor keys. MUST be a
# persistent mount: the service runs the container with --rm, so anything left
# inside the container's ~/.coinswap is destroyed on every restart/update.
mkdir -p "$WALLET_DIR"
chown 1000:1000 "$WALLET_DIR"
info "${WALLET_DIR} -> ~/.coinswap (wallets, fidelity bonds, swap history)"
info "both owned by uid 1000 (container's appuser)"

# ------------------------------------------------ Matrix (optional) ----

bold "4. Matrix notifications (E2EE, optional)"
read -r -p "  Set up encrypted Matrix notifications now? [y/N] " choice
matrix_enabled=""
case "${choice,,}" in
y | yes)
	# Always ensure the matrix-commander binary is present. teardown.sh
	# wipes the venv + symlink while it can leave credentials in place, so
	# the "keep existing creds" branch below would otherwise end up with
	# creds but no CLI to use them.
	if ! command -v matrix-commander >/dev/null ||
		[ ! -x "${MC_VENV}/bin/matrix-commander" ]; then
		info "installing system dependencies for matrix-commander..."
		install_matrix_deps >/dev/null

		info "installing matrix-commander into ${MC_VENV}..."
		mkdir -p "$(dirname "$MC_VENV")"
		python3 -m venv "$MC_VENV"
		"${MC_VENV}/bin/pip" install --quiet --upgrade pip
		"${MC_VENV}/bin/pip" install --quiet matrix-commander
		ln -sf "${MC_VENV}/bin/matrix-commander" /usr/local/bin/matrix-commander
		info "matrix-commander $(${MC_VENV}/bin/matrix-commander --version 2>&1 | head -1)"
	else
		info "matrix-commander already installed"
	fi

	if [ -f "$MC_CREDS" ]; then
		read -r -p "  ${MC_CREDS} exists. Reconfigure from scratch? [y/N] " ow
		case "${ow,,}" in
		y | yes)
			rm -rf "$MC_DIR"
			;;
		*)
			info "keeping existing Matrix setup"
			matrix_enabled=1
			;;
		esac
	fi

	if [ -z "$matrix_enabled" ]; then

		read -r -p "  Matrix homeserver URL [https://matrix.org]: " hs
		hs="${hs:-https://matrix.org}"

		user=""
		while [ -z "$user" ] || [ "${user:0:1}" != "@" ]; do
			read -r -p "  Bot user (e.g. @maker-dashboard-bot:matrix.org): " user
			[ -n "$user" ] && [ "${user:0:1}" = "@" ] || warn "must start with @"
		done

		pw=""
		while [ -z "$pw" ]; do
			read -r -s -p "  Bot password (hidden): " pw
			echo
			[ -n "$pw" ] || warn "cannot be empty"
		done

		rid=""
		while [ "${rid:0:1}" != "!" ]; do
			read -r -p "  Default room ID (starts with '!'): " rid
			[ "${rid:0:1}" = "!" ] || warn "must start with !"
		done

		read -r -p "  Device label [maker-dashboard-$(hostname)]: " dev
		dev="${dev:-maker-dashboard-$(hostname)}"

		install -d -m 0700 "$MC_DIR"

		info "logging in (creates encrypted device, fetches initial keys)..."
		matrix-commander \
			-c "$MC_CREDS" -s "$MC_STORE" \
			--login password \
			--homeserver "$hs" \
			--user-login "$user" \
			--password "$pw" \
			--device "$dev" \
			--room-default "$rid" >/dev/null
		unset pw

		chmod 0600 "$MC_CREDS"
		info "credentials at ${MC_CREDS} (mode 0600)"

		info "sending test message..."
		if matrix-commander -c "$MC_CREDS" -s "$MC_STORE" \
			-m "[maker-dashboard] Notification setup complete on $(hostname)" >/dev/null; then
			info "test send OK"
		else
			warn "test send failed (check homeserver/room/credentials)"
		fi

		warn "RECOMMENDED: verify this device from Element to clear the 'unverified'"
		warn "warning shown next to bot messages. On this VPS run:"
		warn "  sudo matrix-commander -c ${MC_CREDS} -s ${MC_STORE} --verify emoji"
		warn "Then in Element, initiate verification for the new '${dev}' session"
		warn "and confirm the emojis match on both sides."

		matrix_enabled=1
	fi
	;;
*)
	info "skipped (re-run setup.sh to enable later)"
	;;
esac

# ----------------------------------------------- pull + verify image ----

bold "5. Pull and verify image"
IMAGE="${IMAGE_NAME}:master"
# Overridable for testing (manual signatures) or forks.
CERT_IDENTITY="${CERT_IDENTITY:-https://github.com/${REPO}/${WORKFLOW_PATH}@refs/heads/${BRANCH}}"
CERT_OIDC_ISSUER="${CERT_OIDC_ISSUER:-https://token.actions.githubusercontent.com}"

resolve_digest() {
	docker image inspect --format '{{index .RepoDigests 0}}' "$1" 2>/dev/null |
		awk -F'@' '{print $2}'
}

before="$(resolve_digest "$IMAGE" || true)"
info "current digest: ${before:-<none>}"
info "pulling ${IMAGE}..."
docker pull "$IMAGE"

digest="$(resolve_digest "$IMAGE")"
[ -n "$digest" ] || fatal "could not resolve image digest after pull"

if [ -z "$before" ]; then
	info "freshly pulled: ${digest}"
elif [ "$before" = "$digest" ]; then
	info "image already up to date (${digest})"
else
	info "updated: ${before} -> ${digest}"
fi

info "verifying signature against ${CERT_IDENTITY}"
cosign verify \
	--certificate-identity "$CERT_IDENTITY" \
	--certificate-oidc-issuer "$CERT_OIDC_ISSUER" \
	"${IMAGE_NAME}@${digest}" >/dev/null ||
	fatal "signature verification FAILED. Aborting."
info "signature OK (${digest})"

# ------------------------------------------------------- enable service ----

bold "6. Enable and start service"
systemctl daemon-reload
systemctl enable --now maker-dashboard.service
sleep 1
# `head` closes the pipe early; mask the SIGPIPE so `set -o pipefail` doesn't
# kill the script before step 7.
systemctl status maker-dashboard.service --no-pager -l | head -10 || true

if [ -n "$matrix_enabled" ] && command -v notify-matrix.sh >/dev/null; then
	short="${digest#sha256:}"
	short="${short:0:12}"
	host="$(hostname)"
	plain="[maker-dashboard] Setup complete on ${host}, image ${short}"
	html="<strong>[maker-dashboard]</strong> <strong>Setup complete</strong> on <code>${host}</code><br/>Image: <code>${short}</code><br/>Status: <code>active</code>"
	notify_out="$(notify-matrix.sh "$plain" "$html" 2>&1)" &&
		info "Matrix notification sent" || {
		warn "Matrix notification failed (deploy itself succeeded):"
		printf '    %s\n' "$notify_out" | head -20
	}
fi

# ---------------------------------------------------- auto-deploy ----

bold "7. Automatic deploys (optional)"
read -r -p "  Pull and deploy new builds automatically? [y/N] " choice
auto_enabled=""
ntfy_enabled=""
case "${choice,,}" in
y | yes)
	systemctl enable --now maker-dashboard-update.timer
	info "fallback timer enabled (checks every ~30 min)"
	auto_enabled=1

	read -r -p "  Also enable instant push triggers via ntfy? [y/N] " pchoice
	case "${pchoice,,}" in
	y | yes)
		read -r -p "  ntfy server URL [https://ntfy.sh]: " ns
		ns="${ns:-https://ntfy.sh}"

		read -r -p "  ntfy topic [random]: " topic
		if [ -z "$topic" ]; then
			topic="maker-dashboard-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
			info "generated topic: ${topic}"
		fi

		install -d -m 0700 /etc/maker-dashboard
		umask 077
		cat >/etc/maker-dashboard/ntfy.env <<EOF
NTFY_URL=${ns}
NTFY_TOPIC=${topic}
EOF
		chmod 0600 /etc/maker-dashboard/ntfy.env

		systemctl enable --now maker-dashboard-listener.service
		info "listener subscribed to ${ns}/${topic}"
		ntfy_enabled=1

		warn "Add these as GitHub Actions repository secrets so CI can trigger deploys:"
		warn "  NTFY_TOPIC = ${topic}"
		if [ "$ns" != "https://ntfy.sh" ]; then
			warn "  NTFY_URL   = ${ns}"
		fi
		;;
	*)
		info "skipped ntfy push (timer still active)"
		;;
	esac
	;;
*)
	info "skipped (deploy manually with: sudo maker-dashboard-update.sh)"
	;;
esac

# ---------------------------------------------------- log forwarder ----

forwarder_enabled=""
if [ -n "$matrix_enabled" ]; then
	bold "8. Forward WARN/ERROR logs to Matrix (optional)"
	read -r -p "  Enable the log forwarder? [y/N] " choice
	case "${choice,,}" in
	y | yes)
		systemctl enable --now maker-dashboard-forwarder.service
		info "forwarder enabled (dedupe 5 min, max 10 msgs/min)"
		forwarder_enabled=1
		;;
	*)
		info "skipped"
		;;
	esac
fi

# ------------------------------------------------------------- done ----

bold "Done"
info "Dashboard listening on 127.0.0.1:3000. Point your reverse proxy at it."
echo
if [ -n "$ntfy_enabled" ]; then
	info "Deploys: push to main -> CI builds/signs -> ntfy triggers a pull within seconds."
	info "Fallback timer also checks every ~30 min. Manual: sudo maker-dashboard-update.sh"
elif [ -n "$auto_enabled" ]; then
	info "Deploys: fallback timer pulls new builds every ~30 min."
	info "Manual: sudo maker-dashboard-update.sh"
else
	info "Deploys: sudo maker-dashboard-update.sh"
fi
if [ -n "$matrix_enabled" ]; then
	info "Matrix notifications fire automatically on each deploy."
fi
