# Packaging

Installation packages for running Maker Dashboard on Bitcoin node platforms.

| Platform          | Directory           | Port  |
| ----------------- | ------------------- | ----- |
| [Umbrel](umbrel/) | `packaging/umbrel/` | 3010  |
| [myNode](mynode/) | `packaging/mynode/` | 14200 |

For manual installation without a node platform, see the [Docker setup](#docker) or [bare-metal setup](#bare-metal) below.

## Docker

Run with Docker directly:

```sh
docker run -d \
  --name maker-dashboard \
  --network host \
  --volume ~/.config/maker-dashboard:/root/.config/maker-dashboard \
  --volume ~/.coinswap:/root/.coinswap \
  --env MAKER_DASHBOARD_HOST=127.0.0.1 \
  --env MAKER_DASHBOARD_PORT=3000 \
  coinswap/maker-dashboard:master
```

Open `http://127.0.0.1:3000`.

`--network host` gives the container access to your local Tor daemon at `127.0.0.1:9050`. Remove it if you do not need Tor.

## Bare-metal

Build from source and run:

```sh
make build
./target/release/maker-dashboard
```

See the [main README](../README.md) for build prerequisites and configuration options.

## Tor

The coinswap library connects to Tor at `127.0.0.1:9050` (SOCKS) and `127.0.0.1:9051` (control). For bare-metal and Docker with host networking this works without configuration. For Umbrel, where each container has its own network namespace, see the [Umbrel README](umbrel/README.md).
