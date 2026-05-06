# Umbrel Packaging

Coinswap Maker Dashboard packaged for the [Umbrel app store](https://github.com/getumbrel/umbrel-apps).

## Architecture

The app runs three containers:

- **tor:** Tor proxy providing SOCKS (9050) and control (9051) ports
- **web:** The maker-dashboard binary, sharing Tor's network via `network_mode: "service:tor"` so the coinswap library can reach Tor at `127.0.0.1`
- **app_proxy:** Umbrel's auth proxy, routes traffic to the web container through the Tor container's hostname

## Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Container definitions |
| `umbrel-app.yml` | App manifest (name, version, description, port) |
| `exports.sh` | Environment variables shared with other Umbrel apps |
| `torrc.template` | Tor configuration (SOCKS + control port) |

## Prerequisites

- [Umbrel dev environment](https://github.com/getumbrel/umbrel) cloned and running
- Docker image `coinswap/maker-dashboard:master` published on Docker Hub

## Testing locally

All commands are available through `test-on-umbrel.sh`. Set `UMBREL_DIR` if you already have the umbrel repo cloned, otherwise the script clones it automatically.

```sh
# Optional: point to an existing umbrel repo clone
export UMBREL_DIR=/path/to/umbrel
```

### First time setup

```sh
./test-on-umbrel.sh setup
```

Clones the umbrel repo (if needed), starts umbrel-dev, and waits until it's ready. Create an account at `http://umbrel-dev.local` on first run.

### Install

```sh
./test-on-umbrel.sh install
```

Copies the app files to umbrel-dev and installs. Opens at `http://umbrel-dev.local:3010`.

### Reinstall after changes

```sh
./test-on-umbrel.sh reinstall
```

Uninstalls the previous version, copies updated files, and installs again.

### Debugging

```sh
./test-on-umbrel.sh status       # container status and app state
./test-on-umbrel.sh logs         # all container logs
./test-on-umbrel.sh logs-web     # dashboard logs only
./test-on-umbrel.sh logs-tor     # tor logs only
./test-on-umbrel.sh logs-proxy   # app_proxy logs only
./test-on-umbrel.sh shell        # shell inside umbrel-dev
```

### Uninstall

```sh
./test-on-umbrel.sh uninstall
```

## Verify persistence

1. Create a maker through the dashboard UI
2. Restart the app (right-click icon > Restart on the Umbrel homescreen)
3. Confirm the maker config is still there

Data is stored in two volumes:
- `/root/.config/maker-dashboard` — dashboard config (`makers.json`)
- `/root/.coinswap` — coinswap wallet and data directories

## Tor

The coinswap library hardcodes Tor connections to `127.0.0.1`. To work around this in Docker (where Tor runs in a separate container), the web container uses `network_mode: "service:tor"` to share the Tor container's network namespace. Both containers see the same `127.0.0.1`.

The Tor control password is `moneyprintergobrrr` (standard across Umbrel apps). Pass this as `tor_auth` when creating a maker.
