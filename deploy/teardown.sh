#!/usr/bin/env bash
# Reverse of setup.sh: stop/disable/remove the deploy artifacts, leaving the
# host clean enough to re-run setup.sh from scratch.
#
# Preserves the data dirs by default:
#   /var/lib/maker-dashboard/          - auth.json + encrypted maker configs
#   /var/lib/maker-dashboard-coinswap/ - maker WALLETS, fidelity bonds, swap
#                                        history, per-maker Tor keys
# Other state (Matrix credentials, ntfy topic, forwarder cursor, cached Docker
# image) is removed interactively.
#
# Run as root: sudo deploy/teardown.sh

set -uo pipefail

DATA_DIR="/var/lib/maker-dashboard"
WALLET_DIR="/var/lib/maker-dashboard-coinswap"
MC_DIR="/etc/maker-dashboard/matrix-commander"
NTFY_ENV="/etc/maker-dashboard/ntfy.env"
FORWARDER_STATE="/var/lib/maker-dashboard-forwarder"
MC_VENV="/opt/maker-dashboard/matrix-commander-venv"
IMAGE="docker.io/coinswap/maker-dashboard"

bold()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
info()  { printf '  %s\n' "$*"; }
warn()  { printf '  \033[33m%s\033[0m\n' "$*"; }
fatal() { printf '\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fatal "must run as root (use sudo)"

ask_yes() {
    # ask_yes "prompt"  -> returns 0 for yes, 1 for no (default no)
    local reply
    read -r -p "  $1 [y/N] " reply || reply=""
    case "${reply,,}" in y|yes) return 0 ;; *) return 1 ;; esac
}

ask_no() {
    # ask_no "prompt"  -> returns 0 for yes, 1 for no (default yes)
    local reply
    read -r -p "  $1 [Y/n] " reply || reply=""
    case "${reply,,}" in n|no) return 1 ;; *) return 0 ;; esac
}

# ---------------------------------------------------- stop services ----

bold "1. Stop and disable services"
for unit in \
    maker-dashboard-forwarder.service \
    maker-dashboard-listener.service \
    maker-dashboard-update.timer \
    maker-dashboard-update.service \
    maker-dashboard.service \
; do
    if systemctl list-unit-files "$unit" >/dev/null 2>&1; then
        systemctl disable --now "$unit" 2>/dev/null && info "disabled ${unit}" \
            || info "${unit} was not active"
    fi
done

# Ensure the dashboard container is actually gone (the unit's ExecStop helps,
# but the container can survive an aborted stop).
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx maker-dashboard; then
    docker rm -f maker-dashboard >/dev/null && info "removed maker-dashboard container"
fi

# ---------------------------------------------------- remove units ----

bold "2. Remove systemd unit files"
for unit in \
    maker-dashboard.service \
    maker-dashboard-update.service \
    maker-dashboard-update.timer \
    maker-dashboard-listener.service \
    maker-dashboard-forwarder.service \
; do
    if [ -f "/etc/systemd/system/${unit}" ]; then
        rm -f "/etc/systemd/system/${unit}"
        info "removed ${unit}"
    fi
done
systemctl daemon-reload

# ---------------------------------------------------- remove scripts ----

bold "3. Remove deploy scripts"
for f in \
    maker-dashboard-update.sh \
    maker-dashboard-listen.sh \
    maker-dashboard-forwarder.py \
    notify-matrix.sh \
    matrix-commander \
; do
    if [ -e "/usr/local/bin/${f}" ] || [ -L "/usr/local/bin/${f}" ]; then
        rm -f "/usr/local/bin/${f}"
        info "removed /usr/local/bin/${f}"
    fi
done

# matrix-commander venv (always safe to remove; setup.sh recreates it)
if [ -d "$MC_VENV" ]; then
    rm -rf "$MC_VENV"
    info "removed ${MC_VENV}"
fi

# ---------------------------------------------------- forwarder state ----

if [ -d "$FORWARDER_STATE" ]; then
    bold "4. Forwarder cursor state"
    info "${FORWARDER_STATE} only holds a journald cursor (no user data)."
    if ask_no "Remove it?"; then
        rm -rf "$FORWARDER_STATE"
        info "removed"
    fi
fi

# ---------------------------------------------------- ntfy topic ----

if [ -f "$NTFY_ENV" ]; then
    bold "5. ntfy topic"
    info "${NTFY_ENV} holds your push-trigger topic + server URL."
    info "Removing it means a new random topic next setup -> update GitHub secret."
    if ask_yes "Remove it?"; then
        rm -f "$NTFY_ENV"
        info "removed"
    fi
fi

# ---------------------------------------------------- matrix creds ----

if [ -d "$MC_DIR" ]; then
    bold "6. Matrix-commander credentials"
    info "${MC_DIR} holds the bot's encrypted device keys + access token."
    info "Removing it means re-login + re-verify against your Element session."
    if ask_yes "Remove it?"; then
        rm -rf "$MC_DIR"
        info "removed"
    fi
fi

# ---------------------------------------------------- /etc/maker-dashboard ----

# Clean up the parent dir if it ended up empty.
if [ -d /etc/maker-dashboard ] && [ -z "$(ls -A /etc/maker-dashboard 2>/dev/null)" ]; then
    rmdir /etc/maker-dashboard
fi

# ---------------------------------------------------- docker image ----

if docker image inspect "${IMAGE}:master" >/dev/null 2>&1; then
    bold "7. Cached Docker image"
    info "${IMAGE}:master is cached locally (gets re-pulled on next deploy)."
    if ask_yes "Remove it?"; then
        docker rmi "${IMAGE}:master" >/dev/null 2>&1 \
            && info "removed ${IMAGE}:master" \
            || warn "could not remove (other tags/containers may reference it)"
    fi
fi

# ---------------------------------------------------- summary ----

bold "Done"
if [ -d "$DATA_DIR" ]; then
    info "Preserved: ${DATA_DIR} (auth.json + encrypted maker configs)."
fi
if [ -d "$WALLET_DIR" ]; then
    warn "Preserved: ${WALLET_DIR} (maker WALLETS, fidelity bonds, swap history)."
    warn "  This holds your funds. Back it up before deleting anything."
fi
if [ -d "$DATA_DIR" ] || [ -d "$WALLET_DIR" ]; then
    info "  To wipe ALL data: sudo rm -rf ${DATA_DIR} ${WALLET_DIR}"
fi
info "cosign was NOT removed (broadly useful; setup.sh skips it if present)."
echo
info "Re-run setup with: sudo deploy/setup.sh"
