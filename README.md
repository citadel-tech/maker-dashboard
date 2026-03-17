# Maker Dashboard

A web dashboard for managing [Coinswap](https://github.com/citadel-tech/coinswap) maker nodes.

> **Before deploying:** read [SECURITY.md](SECURITY.md). The dashboard manages hot wallets holding real Bitcoin. There are important things to understand about access control, wallet key storage, and fidelity bond timelocks before you run this in production.

## What is a Maker?

In the Coinswap protocol, a **maker** is a liquidity provider. Makers run a server that listens for swap requests from takers, route Bitcoin through their wallets to break transaction history, and earn fees in return. Makers need to run continuously and maintain a **fidelity bond**. a time-locked Bitcoin deposit that proves their long-term commitment and deters Sybil attacks.

Coinswap's own `makerd` daemon is normally operated through `maker-cli`, a command-line RPC client. The Maker Dashboard replaces that with a browser-based UI while keeping the same underlying coinswap library.

For more background on the Coinswap protocol and the maker role, see the [Coinswap documentation](https://github.com/citadel-tech/coinswap/tree/master/docs).

## Prerequisites

- A running **Bitcoin Core** node with RPC and ZMQ enabled. The default expected address is `127.0.0.1:38332` for RPC and `tcp://127.0.0.1:28332` for ZMQ. See the coinswap [bitcoind setup guide](https://github.com/citadel-tech/coinswap/blob/master/docs/bitcoind.md).
- **Rust** toolchain (`cargo`) for building the backend.
- **Node.js** and **npm** for building the frontend.

## Building and Running

Build both the frontend and the backend, then run the server:

```sh
make build
make run
```

Or build and run them separately:

```sh
# Backend only
cargo build --release
./target/release/maker-dashboard

# Frontend only (dev server, proxies /api to localhost:3000)
cd frontend && npm install && npm run dev
```

The server listens on `http://127.0.0.1:3000` by default. Open that address in your browser to use the dashboard. Interactive API documentation is available at `http://127.0.0.1:3000/swagger-ui/`.

## Configuration

All options can be set via command-line flags or environment variables:

| Flag | Env var | Default | Description |
|------|---------|---------|-------------|
| `--host` | `DASHBOARD_HOST` | `127.0.0.1` | IP address to bind to |
| `--port` | `DASHBOARD_PORT` | `3000` | Port to listen on |
| `--allow-remote` | `DASHBOARD_ALLOW_REMOTE` | `false` | Accept requests from non-localhost |
| `--config-dir` | `DASHBOARD_CONFIG_DIR` | `~/.config/maker-dashboard` | Config and log directory |
| `--log-filter` | `DASHBOARD_LOG_FILTER` | `tower_http=info,debug` | Tracing filter directive |
| `--no-color` | `DASHBOARD_NO_COLOR` | `false` | Disable ANSI colors in logs |

By default the server only accepts connections from the local machine. If you need to expose it on a network, set `--allow-remote` and put a reverse proxy with TLS and authentication in front of it.

Dashboard state (registered maker configs) is stored at `~/.config/maker-dashboard/makers.json`. Per-maker logs go to `~/.config/maker-dashboard/logs/maker-{id}.log`. Maker wallet files live under `~/.coinswap/{id}/`, which is managed by the coinswap library directly.

## Adding a Maker

Once the dashboard is running, open it in your browser and create a maker. You will need:

- A unique ID for the maker (any string, e.g. `maker-1`).
- Bitcoin Core RPC credentials (`rpc_user` and `rpc_password`).
- The RPC address and ZMQ address of your Bitcoin Core node.
- Optionally: a custom `network_port` and `rpc_port` if you are running multiple makers on the same host (defaults are 6102 and 6103 respectively).

After creating a maker, it starts in the **stopped** state. Click **Start** to launch the coinswap server. The maker will attempt to create a fidelity bond on its first run. this requires the maker wallet to have enough funds (at least ~50,000 sats). Use the **Address** tab to get a deposit address and fund the wallet from the [Mutinynet faucet](https://faucet.mutinynet.com/).

## Running Tests

```sh
# Unit tests
cargo test

# HTTP API tests (no external dependencies)
cargo test --test api

# Full integration test (requires bitcoind + Nostr relay, easiest via Docker)
make test-integration-docker
```

## References

- [Coinswap repository](https://github.com/citadel-tech/coinswap)
- [Makerd setup guide](https://github.com/citadel-tech/coinswap/blob/master/docs/makerd.md)
- [maker-cli reference](https://github.com/citadel-tech/coinswap/blob/master/docs/maker-cli.md)
- [Fidelity bonds explained](https://github.com/citadel-tech/coinswap/blob/master/docs/makerd.md#fidelity-bond-check)
- [Architecture overview](docs/ARCH.md)
