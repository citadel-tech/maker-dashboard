# Contributing to Maker Dashboard

Before diving in, read [docs/ARCH.md](docs/ARCH.md) to understand how the codebase is structured. It explains the threading model, the request flow, and where to find each piece of logic.

## Setting up for development

You need Rust (stable) and Node.js (LTS or later).

```sh
git clone https://github.com/citadel-tech/maker-dashboard
cd maker-dashboard
cargo build
cd frontend && npm install
```

Run the backend and frontend dev servers in two terminals:

```sh
# Terminal 1 -- backend (API on localhost:3000)
cargo run

# Terminal 2 -- frontend dev server (proxies /api to localhost:3000)
cd frontend && npm run dev
```

## Running tests

```sh
# Unit tests
cargo test

# HTTP API tests -- spins up a real in-process server, no external deps needed
cargo test --test api

# Run a subset by name
cargo test --test api makers

# Full integration test -- easiest via Docker (builds everything in one container)
make test-integration-docker
```

If you want to run the integration test locally without Docker, you need a `bitcoind`
binary and a Nostr relay listening on `127.0.0.1:8000`:

```sh
BITCOIND_EXE=/path/to/bitcoind \
  cargo test --test integration_test --features integration-test -- --nocapture
```

## Adding a new API endpoint

1. Add the handler in the relevant file under `src/api/` (or a new file for a new domain).
2. Register the route in that file's `routes()` function.
3. Add any new request/response types to `src/api/dto.rs`.
4. Annotate the handler with `#[utoipa::path(...)]` so it shows up in the Swagger UI.
5. Add a typed wrapper in `frontend/app/api.ts`.
6. Update `docs/ARCH.md` if the endpoint list or behaviour has changed.

## Commit style

This repo uses [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(api): add GET /api/makers/{id}/tor-address
fix(pool): correctly join message thread on remove_maker
test(backend): HTTP API tests for wallet endpoints
docs: update ARCH.md endpoint list
```

Common types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.

## Opening a pull request

Keep PRs focused on one thing. Make sure `cargo test --test api` passes and `cargo clippy`
reports no warnings in code you touched before opening.
