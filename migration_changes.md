# Unified Maker Migration Changes

This document summarizes the implementation work from `execution.md`, file by file.
Each entry gives a short explanation of what changed and why.

## Dependency

### `Cargo.toml`
- Changed `coinswap` from the old split-maker revision to the upstream unified-protocol revision.
- Why: the new `MakerServer` API does not exist in the previous pinned dependency.

### `Cargo.lock`
- Refreshed the lockfile after updating the `coinswap` revision.
- Why: the build needed to resolve the new upstream dependency graph.

## Backend

### `src/maker_manager/mod.rs`
- Replaced the legacy `Maker` / `TaprootMaker` init flow with a single `MakerServer` init path.
- Removed the `taproot` config flag and added unified config fields like `time_relative_fee_pct`, `nostr_relays`, and `required_confirms`.
- Added network inference for the upstream `MakerServerConfig`.
- Why: the dashboard runtime now targets the unified coinswap maker server and must preserve the new config shape through creation and updates.

### `src/maker_manager/maker_pool.rs`
- Removed the old maker-handle enum and now stores a single `Arc<MakerServer>`.
- Switched server startup to `start_server(...)` and renamed maker threads to `maker-{id}`.
- Updated wallet access to use the unified maker server’s public fields and new wallet API signatures.
- Why: the pool no longer needs legacy-vs-taproot branching, and log routing depends on the new thread naming.

### `src/maker_manager/persistence.rs`
- Removed persisted `taproot`.
- Added persistence support for `time_relative_fee_pct`, `nostr_relays`, and `required_confirms`.
- Kept serde defaults for backward compatibility when loading older `makers.json` files.
- Why: existing installs need to keep loading cleanly while new config fields round-trip correctly.

### `src/api/dto.rs`
- Removed `taproot` from create/update requests and detailed maker responses.
- Added `time_relative_fee_pct` and `nostr_relays` to the API contract.
- Updated request examples/default-aligned values and preserved backend-only fields during config merges.
- Why: the Rust DTOs needed to match the new backend config and the frontend contract.

### `src/api/makers.rs`
- Updated create-maker defaults to the unified coinswap defaults.
- Removed `taproot` handling and now accepts the new fee/relay fields.
- Why: the HTTP layer should construct the same config shape the unified backend expects.

### `src/utils/log_writer.rs`
- Changed per-maker log routing to recognize `maker-{id}` thread names instead of `legacy-{id}` / `taproot-{id}`.
- Why: without this change, maker logs would stop being written to the correct per-maker files after the runtime migration.

## Frontend

### `frontend/app/api.ts`
- Removed `taproot` from frontend request/response types.
- Added `time_relative_fee_pct` and `nostr_relays` to the TypeScript API types.
- Why: the frontend type layer needed to stay in sync with the Rust DTO changes.

### `frontend/app/routes/onboarding.tsx`
- Removed the taproot toggle and stopped sending `taproot` in the maker-create payload.
- Why: the unified backend no longer accepts or needs that field.

### `frontend/app/routes/addMaker.tsx`
- Removed the taproot checkbox and dropped `taproot` from the submit body.
- Why: same as onboarding; the field is obsolete after the migration.

### `frontend/app/routes/makerDetails/settings.tsx`
- Removed the taproot setting UI.
- Added load/save support for `time_relative_fee_pct`.
- Updated placeholders/default displays to match the backend defaults.
- Why: settings needed to edit the new fee config without silently resetting it, and it should no longer expose a dead protocol toggle.

### `frontend/app/routes/makerDetails/dashboard.tsx`
- Replaced the taproot status card with a fee/config summary card.
- Why: the old card no longer reflected a real runtime choice, so the space was repurposed with useful config data.

### `frontend/app/routes/makersetup.tsx`
- Simplified the live-state log detection to generic matching that still works with the upstream maker startup lines.
- Why: setup should no longer depend on the removed frontend taproot distinction and should be resilient to exact log prefixes.

### `frontend/app/routes/makerDetails/log.tsx`
- Updated comments/examples to refer to `maker-*` thread names.
- Why: developer-facing notes should match the new logging behavior.

## Tests

### `tests/integration_test.rs`
- Removed the stale `taproot` field from the maker creation request helper.
- Why: integration requests should match the new API contract.

## Verification Performed

- Ran `cargo fmt`
- Ran `cd frontend && npx prettier --write .`
- Ran `cargo build`
- Ran `cd frontend && npm run build`
- Ran `cargo test --test api`

## Notes

- `execution.md` was used as the implementation checklist but was not modified.
- The API test run required network access because `utoipa-swagger-ui` downloads Swagger UI assets during its build step.
