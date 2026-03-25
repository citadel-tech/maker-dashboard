# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Maker Dashboard is a full-stack application for managing Coinswap maker nodes. The Rust/Axum backend exposes a REST API; the React/TypeScript frontend is served as static files from the same process in production. Makers are liquidity providers in the Coinswap privacy protocol.

## Commands

### Backend
```sh
cargo build --release          # build
cargo test                     # unit tests
cargo test --test api          # HTTP API tests (no external deps)
cargo test --test integration_test --features integration-test -- --nocapture  # integration test (needs bitcoind + nostr relay)
```

### Frontend
```sh
cd frontend && npm install     # install deps
npm run dev                    # dev server (proxies /api to localhost:3000)
npm run build                  # production build → frontend/build/client/
```

### Full stack
```sh
make build                     # frontend build + cargo build --release
make run                       # build + run (serves built frontend)
make test-integration-docker   # self-contained integration test via Docker
```

### Running a single test
```sh
cargo test --test api makers   # runs only tests matching "makers" in the api test binary
```

## Architecture

### Request flow
```
HTTP request → restrict_to_localhost middleware → Axum router
    → api handler (acquires Arc<Mutex<MakerManager>>)
    → MakerManager (orchestration + persistence)
    → MakerPool (routes to the correct running maker)
    → bidirectional channel → maker background thread (Coinswap lib)
```

### Key modules

**`src/maker_manager/`** — core business logic:
- `mod.rs`: `MakerManager` — create/start/stop/restart makers, persist configs, handle config updates with rollback
- `maker_pool.rs`: `MakerPool` — spawns one background thread per running maker, routes `MessageRequest` through bidirectional channels
- `message.rs`: `MessageRequest`/`MessageResponse` enums — the IPC contract between HTTP handlers and maker threads
- `persistence.rs`: reads/writes maker configs to `~/.config/maker-dashboard/makers.json`

**`src/api/`** — thin HTTP handlers, one file per domain (`makers`, `wallet`, `monitoring`, `fidelity`). All handlers share `Arc<Mutex<MakerManager>>` as Axum state.

**`src/server.rs`** — router setup, static file serving, SPA fallback, Swagger UI mount.

**`frontend/app/api.ts`** — typed TypeScript wrapper around all `/api` calls. Add new endpoint clients here.

### Important design constraints

- Each maker runs in its own OS thread (Coinswap lib is synchronous). The Axum async layer talks to maker threads via `bidirectional_channel`.
- Makers are NOT auto-started on dashboard restart — configs are restored from disk but makers start stopped.
- Config updates (`PUT /api/makers/:id/config`) tear down and re-initialize the maker; if re-init fails, the old config is restored.
- Localhost-only access is enforced by middleware unless `--allow-remote` / `DASHBOARD_ALLOW_REMOTE` is set.
- Log level is controlled by `DASHBOARD_LOG_FILTER` (tracing directives). Per-maker logs go to `~/.config/maker-dashboard/logs/maker-{id}.log`.

## Integration Test

The integration test (`tests/integration_test.rs`) requires:
1. **Nostr relay** on `127.0.0.1:8000` — in CI this is started by `hulxv/nostr-relay-action`; locally use `make test-integration-docker`
2. **`BITCOIND_EXE`** env var pointing to a `bitcoind` binary — set automatically in the Docker image

`make test-integration-docker` builds `docker/Dockerfile.integration-test` which installs both dependencies and runs the test in a single container.

## API Response Shape

All endpoints return `ApiResponse<T>` (defined in `src/api/dto.rs`):
```json
{ "success": true,  "data": <T> }
{ "success": false, "error": "<message>" }
```


## Orchestration Protocol

**Always output the planning doc visibly before any file read or edit. 
This is not optional. Even for single-agent small tasks.**

When given a task, always follow this pipeline. Do not skip steps.

### Step 1 — Plan first, code never first

Before touching any file, produce a planning doc in this format:
```
## Task: <one line summary>

### Affected files
- `src/api/makers.rs` — reason
- `frontend/app/routes/makers.tsx` — reason

### Agent assignments
- Agent 1: [file list] — [what it does]
- Agent 2: [file list] — [what it does]

### Complexity: small | medium | large
### Agent count: 1 | 2 | 5
```

Rules for agent count:
- **1 agent** — single file, or changes are tightly coupled across files
- **2 agents** — 2-4 files, clearly separable (e.g. backend + frontend split)
- **5 agents** — 5+ files, each agent owns a distinct module/domain

### Step 2 — Spawn agents via Task tool

Each Task agent receives:
- Its assigned files only (no awareness of other agents' files)
- The specific goal for its slice
- The relevant architecture context from this CLAUDE.md

**Hard rule: no two agents may touch the same file. If a file needs changes from two concerns, one agent owns it and handles both.**

### Step 3 — Review

After all agents complete, spawn 1-2 review Tasks that:
- Read all changed files together
- Check for: type mismatches across the API boundary, broken imports, inconsistent naming, logic errors
- If issues found: report back to planner, re-assign fixes to the relevant agent
- If clean: proceed

### Step 4 — Cleanup

**Run this before verify. No exceptions.**

- Any `.rs` file touched → run `cargo fmt` from project root
- Any `.ts` / `.tsx` file touched → run `cd frontend && npx prettier --write .`
- If both → run both, in that order

### Step 5 — Verify

**Only run this after Step 4 cleanup is confirmed done.**

- If `.rs` changed → `cargo build`
- If `.ts`/`.tsx` changed → `cd frontend && npm run build`
- Report any errors back to planner for a fix cycle