<div align="center">

<img src="assets/coinswap-icon.colored.png" alt="Coinswap Maker Dashboard Logo" width="300" />

<h1 align="center">Coinswap Maker Dashboard</h1>

</div>

A web dashboard for managing [Coinswap](https://github.com/citadel-tech/coinswap) maker nodes.

> **Before deploying:** read [SECURITY.md](SECURITY.md). The dashboard manages hot wallets holding real Bitcoin. Make sure you understand the access-control model, wallet storage, and fidelity bond requirements before exposing it to real funds.

## What This App Does

Maker Dashboard is a full-stack app with:

- A Rust/Axum backend that exposes a localhost-first REST API
- A React frontend for onboarding, maker management, wallet actions, logs, and swap history
- Production static-file serving from the same backend process
- Swagger UI at `/swagger-ui/` for interactive API exploration

The dashboard keeps maker registrations on disk, lets you start and stop makers from the browser, and surfaces operational state such as balances, Tor address, logs, swap reports, and fidelity bond status.

## What Is a Maker?

In Coinswap, a **maker** is a liquidity provider. Makers listen for swap requests from takers, route Bitcoin through their wallets to improve privacy, and earn fees in return. To participate, a maker needs to stay online and maintain a **fidelity bond**, which is a time-locked Bitcoin deposit used to signal long-term commitment and resist Sybil attacks.

Coinswap's `makerd` daemon is usually operated through `maker-cli`. Maker Dashboard provides a browser-based interface on top of the same underlying coinswap library.

For protocol background, see the [Coinswap documentation](https://github.com/citadel-tech/coinswap/tree/master/docs).

## Prerequisites

- A working **Bitcoin Core** node
- **RPC enabled** on your Bitcoin node
- **REST enabled** on your Bitcoin node (`rest=1`)
- **ZMQ enabled** on your Bitcoin node for real-time block and transaction updates
- A local **Tor** daemon with SOCKS and control ports reachable by the maker
- **Rust** and `cargo` for the backend
- **Node.js** and `npm` for the frontend

Typical local defaults used by the onboarding checks:

- Bitcoin RPC: `127.0.0.1:38332`
- Bitcoin ZMQ: `tcp://127.0.0.1:28332`
- Tor SOCKS: `127.0.0.1:9050`
- Tor control: `127.0.0.1:9051`

## Build And Run

Build everything:

```sh
make build
```

Run the full app:

```sh
make run
```

Useful individual commands:

```sh
# Backend
cargo build --release
cargo run

# Frontend
cd frontend && npm install
cd frontend && npm run dev
cd frontend && npm run build
```

By default the server listens on `http://127.0.0.1:3000`. Open that in your browser to use the dashboard. Swagger UI is available at `http://127.0.0.1:3000/swagger-ui/`.

## First-Run Flow

If there are no registered makers, the home page opens a guided onboarding flow instead of an empty dashboard. The onboarding wizard helps you:

- Verify Bitcoin Core RPC connectivity
- Verify Bitcoin Core REST availability
- Verify the configured ZMQ endpoint
- Verify local Tor SOCKS and control ports
- Create your first maker from the browser

After a maker is created, the UI takes you to a setup screen that tails live logs while the maker initializes and waits for the fidelity bond flow to complete.

## Managing Makers

From the web UI you can:

- Add multiple makers
- Start, stop, and restart makers
- View per-maker balances and UTXOs
- Generate deposit addresses and send funds
- Watch live logs or download log files
- Inspect swap history and swap reports
- Update maker configuration
- Remove a maker registration from the dashboard without deleting its wallet data

Registered makers are restored on dashboard restart, but they are **not auto-started**. They come back in the stopped state until you start them again.

## Configuration

Runtime options can be set with CLI flags or environment variables:

| Flag              | Env var                   | Default                            | Description                                |
| ----------------- | ------------------------- | ---------------------------------- | ------------------------------------------ |
| `--host`          | `DASHBOARD_HOST`          | `127.0.0.1`                        | IP address to bind to                      |
| `--port`          | `DASHBOARD_PORT`          | `3000`                             | Port to listen on                          |
| `--frontend-path` | `DASHBOARD_FRONTEND_PATH` | `frontend/build/client`            | Directory containing built frontend assets |
| `--spa-index`     | `DASHBOARD_SPA_INDEX`     | `frontend/build/client/index.html` | SPA fallback file                          |
| `--allow-remote`  | `DASHBOARD_ALLOW_REMOTE`  | `false`                            | Allow non-localhost requests               |
| `--log-filter`    | `DASHBOARD_LOG_FILTER`    | `tower_http=debug,info`            | Tracing filter directive                   |
| `--no-color`      | `DASHBOARD_NO_COLOR`      | `false`                            | Disable ANSI colors in logs                |
| `--config-dir`    | `DASHBOARD_CONFIG_DIR`    | platform default                   | Dashboard config directory                 |

By default the dashboard only accepts connections from the local machine. If you enable `--allow-remote`, put authentication and TLS in front of it with a reverse proxy.

Dashboard-managed files:

- Registered maker configs: `~/.config/maker-dashboard/makers.json`
- Per-maker logs: `~/.config/maker-dashboard/logs/maker-{id}.log`

Maker wallet and data directories are configured per maker and may differ from the dashboard config directory.

## Adding A Maker

The UI will ask for:

- A unique maker ID
- Bitcoin Core RPC address and credentials
- Bitcoin ZMQ address
- Optional wallet password and wallet name
- Optional custom data directory
- Maker network and RPC ports
- Optional Tor SOCKS and control ports
- Fee and fidelity-bond settings
- Optional Nostr relays

If you run multiple makers on one machine, make sure each maker uses unique network and RPC ports.

On first setup, the maker may need funds to create a fidelity bond. You can use the wallet screen to generate an address, fund it, and then continue setup once the wallet has enough coins.

## Docker

Run the full stack (bitcoind, tor, dashboard) with Docker Compose:

```sh
cd docker
docker compose up --build -d
```

This starts a custom signet bitcoind, a Tor daemon, and the maker dashboard — all sharing the same network namespace. The dashboard is available at `http://localhost:3000`.

When creating a maker, use:
- RPC: `127.0.0.1:38332`, ZMQ: `tcp://127.0.0.1:28332`
- RPC credentials: `user` / `password`
- Tor auth: `coinswap`
- SOCKS port: `9050`, Control port: `9051`

Other useful commands:

```sh
docker compose ps              # status
docker compose logs -f web     # dashboard logs
docker compose down -v         # stop and wipe all data
```

Host-exposed ports: `3000` (dashboard), `38332` (RPC), `28332` (ZMQ), `19050` (Tor SOCKS), `19051` (Tor control).

## Development Commands

Backend:

```sh
cargo test
cargo test --test api
```

Frontend:

```sh
cd frontend && npm run lint
cd frontend && npm run typecheck
cd frontend && npm run build
```

Full-stack helpers:

```sh
make help
make clean
```

## Integration Testing

Local integration test:

```sh
cargo test --test integration_test --features integration-test -- --nocapture
```

Docker-based integration test:

```sh
make test-integration-docker
```

The Docker integration target uses [`docker/Dockerfile.integration-test`](docker/Dockerfile.integration-test) to run the test in a self-contained container with the required services.

## Packaging

Packaging assets for Umbrel, myNode, Docker, and related deployment targets live in [`packaging/`](packaging/README.md).

## References

- [Coinswap repository](https://github.com/citadel-tech/coinswap)
- [Coinswap maker docs](https://github.com/citadel-tech/coinswap/blob/master/docs/makerd.md)
- [maker-cli reference](https://github.com/citadel-tech/coinswap/blob/master/docs/maker-cli.md)
- [Bitcoind setup guide](https://github.com/citadel-tech/coinswap/blob/master/docs/bitcoind.md)
- [Architecture overview](docs/ARCH.md)
