# VPS deployment

Run Maker Dashboard on a Linux VPS. CI signs each image; the VPS verifies the
signature before restarting.

## Prerequisites

- Linux VPS with Docker and systemd
- Root access for the one-time setup
- A reverse proxy in front of `127.0.0.1:3000` (the container only binds
  localhost. don't expose 3000 directly)

## Quick setup

From a clone of the repo on the VPS:

```sh
sudo deploy/setup.sh
```

The script installs cosign, the deploy scripts, and the systemd unit;
creates the data directory; optionally prompts for Matrix credentials;
pulls and verifies the first image; and enables the service. Idempotent,
re-run any time.

For manual control over each step, follow the sections below instead.

## One-time setup (manual)

Install cosign:

```sh
curl -sSLO https://github.com/sigstore/cosign/releases/latest/download/cosign-linux-amd64
sudo install -m 0755 cosign-linux-amd64 /usr/local/bin/cosign
rm cosign-linux-amd64
```

Install the scripts and systemd unit from a clone of this repo:

```sh
sudo install -m 0755 deploy/maker-dashboard-update.sh /usr/local/bin/
sudo install -m 0755 deploy/notify-matrix.sh         /usr/local/bin/
sudo install -m 0644 deploy/maker-dashboard.service  /etc/systemd/system/
```

Create the data directory. The container runs as UID `1000`:

```sh
sudo mkdir -p /var/lib/maker-dashboard
sudo chown 1000:1000 /var/lib/maker-dashboard
```

Pull and verify the first image:

```sh
sudo maker-dashboard-update.sh
```

The `systemctl restart` line will fail initially since the service isn't
enabled yet. Enable it:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now maker-dashboard.service
```

The dashboard is now listening on `127.0.0.1:3000`. Point your reverse proxy
at it.

## Deploy a new build

Every push to `main` produces a new signed `:master` image. To deploy it:

```sh
sudo maker-dashboard-update.sh
```

The script pulls, verifies the cosign signature against this repo's
`docker-publish.yml` workflow on `main`, and restarts the service only if the
digest changed. Idempotent, safe to run by hand or on a cron.

## Automatic deploys

CI never connects to the VPS. The VPS pulls on its own, two ways:

- **Fallback timer** (`maker-dashboard-update.timer`) runs the update script
  every ~30 minutes.
- **Push trigger** (`maker-dashboard-listener.service`) holds an outbound
  subscription to an [ntfy] topic. After CI builds and signs, it publishes to
  the topic and the VPS pulls within seconds. Nothing inbound is opened, and a
  trigger only causes a pull + signature check, so a stray message can't
  deploy anything unsigned.

`sudo deploy/setup.sh` sets both up (step 7) and prints the topic to add as
GitHub secrets. To wire CI, add a repository secret `NTFY_TOPIC` (and
`NTFY_URL` if you self-host ntfy); the build job publishes to it on every push
to `main`. Without the secret, CI skips the trigger and the timer still
deploys.

Manual setup, if not using `setup.sh`:

```sh
# install the units (alongside the cosign + scripts steps above)
sudo install -m 0755 deploy/maker-dashboard-listen.sh /usr/local/bin/
sudo install -m 0644 deploy/maker-dashboard-update.service \
    deploy/maker-dashboard-update.timer \
    deploy/maker-dashboard-listener.service /etc/systemd/system/

# pick a hard-to-guess topic and point the listener at it
sudo install -d -m 0700 /etc/maker-dashboard
printf 'NTFY_URL=%s\nNTFY_TOPIC=%s\n' \
    https://ntfy.sh "maker-dashboard-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')" \
    | sudo tee /etc/maker-dashboard/ntfy.env >/dev/null
sudo chmod 0600 /etc/maker-dashboard/ntfy.env

sudo systemctl daemon-reload
sudo systemctl enable --now maker-dashboard-update.timer
sudo systemctl enable --now maker-dashboard-listener.service
```

## Roll back

Every build also publishes an immutable `:sha-<short>` tag. Pin to it by
overriding `IMAGE`:

```sh
sudo IMAGE=docker.io/coinswap/maker-dashboard:sha-abc123def456 \
     maker-dashboard-update.sh
```

Return to `:master` by running the script with no override.

## Operations

```sh
sudo systemctl status maker-dashboard.service          # service status
sudo journalctl -u maker-dashboard.service -f          # tail app logs
docker inspect --format '{{.Image}}' maker-dashboard   # current image
sudo journalctl -u maker-dashboard-listener -f         # tail deploy-trigger listener
sudo journalctl -u maker-dashboard-update -n 50        # last auto-deploy run
systemctl list-timers maker-dashboard-update.timer     # next fallback check
```

## Matrix notifications (optional, E2EE)

Each deploy can post to a Matrix room with **end-to-end encryption**. The
deploy chain uses [matrix-commander] (Python CLI wrapping `matrix-nio[e2e]`)
so messages are encrypted by Megolm before they leave the VPS.

Easiest path: run `sudo deploy/setup.sh` and answer yes when it asks about
Matrix. The setup script installs matrix-commander in an isolated venv,
prompts for homeserver / bot user / password / room, logs in, and sends a
test message.

For manual setup:

```sh
# 1. System deps for matrix-nio's libolm bindings
sudo apt-get install -y --no-install-recommends \
    python3 python3-venv python3-dev libolm-dev build-essential

# 2. matrix-commander in an isolated venv
sudo python3 -m venv /opt/maker-dashboard/matrix-commander-venv
sudo /opt/maker-dashboard/matrix-commander-venv/bin/pip install "matrix-commander==<tested-version>"
sudo ln -sf /opt/maker-dashboard/matrix-commander-venv/bin/matrix-commander \
    /usr/local/bin/matrix-commander

# 3. One-time login (creates encrypted device + persistent store)
sudo install -d -m 0700 /etc/maker-dashboard/matrix-commander
sudo matrix-commander \
    -c /etc/maker-dashboard/matrix-commander/credentials.json \
    -s /etc/maker-dashboard/matrix-commander/store \
    --login password \
    --homeserver https://matrix.org \
    --user-login '@maker-dashboard-bot:matrix.org' \
    --password '<bot password>' \
    --device 'maker-dashboard-vps1' \
    --room-default '!yourRoomId:matrix.org'
sudo chmod 0600 /etc/maker-dashboard/matrix-commander/credentials.json
```

The bot must be a regular password account, invited to the target room.
matrix.org SSO/2FA accounts will not work with password login.

### Verify the device (recommended)

After login, the bot's session is "unverified" in Element. Messages arrive
encrypted either way, but other room members see a warning icon next to
them. To clear it:

```sh
sudo matrix-commander \
    -c /etc/maker-dashboard/matrix-commander/credentials.json \
    -s /etc/maker-dashboard/matrix-commander/store \
    --verify emoji
```

In Element on a session you already trust, find the new bot session under
the bot user's profile and initiate "Verify session". Confirm the emojis on
both sides.

### What gets sent

Notifications fire only on actual deploy events: deploying (with from->to
sha), deployed (with image sha), signature verification failure, and
restart failure. "No change" runs are silent.

[matrix-commander]: https://github.com/8go/matrix-commander

## Forward WARN/ERROR logs to Matrix (optional)

The `maker-dashboard-forwarder.service` tails the dashboard's journald
output, collects WARN/ERROR lines over a short window, and forwards each
batch as a single Matrix message with the raw lines in a `<pre><code>`
block. Cursor-based: persists a journald position so restarts don't repeat
or miss entries.

Defaults:

- Flush every 30 seconds. Quiet windows produce no message; bursty windows
  collapse into one batched message instead of N separate ones.
- Within a batch, identical lines are deduped — the first appears, repeats
  are counted. Across batches, the same line is suppressed for 5 minutes
  (with a `(+N previously suppressed)` annotation when it next appears).
- Cap of 50 lines per batch; the excess is counted and shown as `(+N
  dropped)` on the message header.

`sudo deploy/setup.sh` offers this as step 8 (only when Matrix is already
configured).

### Manual setup

```sh
sudo install -m 0755 deploy/maker-dashboard-forwarder.py /usr/local/bin/
sudo install -m 0644 deploy/maker-dashboard-forwarder.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now maker-dashboard-forwarder.service
```

### Tuning

Environment variables (set in a drop-in or by editing the unit):

| Var                 | Default                           | Meaning                                                |
| ------------------- | --------------------------------- | ------------------------------------------------------ |
| `FORWARDER_UNIT`    | `maker-dashboard.service`         | unit to tail                                           |
| `LEVELS`            | `WARN,ERROR`                      | comma-separated levels to forward (`INFO` for debug)   |
| `BATCH_WINDOW_SEC`  | `30`                              | flush a batch every N seconds                          |
| `MAX_BATCH_LINES`   | `50`                              | cap on lines per batch; excess shown as `(+N dropped)` |
| `DEDUPE_WINDOW_SEC` | `300`                             | cross-batch suppression window for identical messages  |
| `NOTIFY_CMD`        | `/usr/local/bin/notify-matrix.sh` | sender command                                         |

### Caveats

The dashboard writes all tracing output to stdout, which systemd journals as
priority `info`. The forwarder matches the level token in the message text
(` WARN ` / ` ERROR `) rather than journald priority. If the dashboard ever
starts emitting native journald priorities or writes WARN+ to stderr, switch
to `journalctl -p warning` for cheaper filtering.

## Troubleshooting

**`signature verification FAILED - refusing to deploy`:** the image at
`:master` is not signed by this repo's `main`-branch workflow. Don't bypass
this; it's the security model. Common causes: `IMAGE` points at a fork, the
repo was renamed (set `REPO=newowner/newrepo`), or someone pushed an
unsigned image manually. Investigate before deploying.

**Container exits on start:** check `journalctl -u maker-dashboard.service
-n 50`. Usually: port 3000 already bound, or `/var/lib/maker-dashboard` not
owned by `1000:1000`.

**Matrix notifications not arriving:** test the notifier and the underlying
client directly:

```sh
sudo notify-matrix.sh "test from notify-matrix"
sudo matrix-commander \
    -c /etc/maker-dashboard/matrix-commander/credentials.json \
    -s /etc/maker-dashboard/matrix-commander/store \
    -m "test from matrix-commander"
```

If `notify-matrix.sh` errors with `credentials.json not found`, the Matrix
step in `setup.sh` was skipped or rolled back. If `matrix-commander` itself
fails, check the homeserver URL and that the bot is still a room member.
