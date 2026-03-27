# Unified Protocol Migration — Execution Plan

Tracks all changes needed to align maker-dashboard with the coinswap unified
protocol PR (`3c74bd870a3805791ff30564e0b54eeece14f4d8`), which merged
`Maker` + `TaprootMaker` into a single `MakerServer` type.

Implement in order — backend runtime must compile before touching persistence,
API, then frontend.

---

## 1. Backend — Maker Manager (`src/maker_manager/mod.rs`)

| Task Name | Task Description | Code Site | Suggested Code Change |
|-----------|-----------------|-----------|----------------------|
| Update imports | Replace old maker imports with unified types | `src/maker_manager/mod.rs` line 11 | Replace `use coinswap::maker::{Maker, MakerBehavior, TaprootMaker};` with `use coinswap::maker::{MakerServer, MakerServerConfig};` |
| Remove `taproot` config field | Field no longer exists in upstream lib | `src/maker_manager/mod.rs` — `MakerConfig` struct (line 33) | Delete the `taproot: bool` field from the struct definition |
| Add `time_relative_fee_pct` config field | New upstream config value, needs to round-trip through persistence | `src/maker_manager/mod.rs` — `MakerConfig` struct | Add `time_relative_fee_pct: f64` field to the struct |
| Add `nostr_relays` config field | New upstream config value | `src/maker_manager/mod.rs` — `MakerConfig` struct | Add `nostr_relays: Vec<String>` field to the struct |
| Update `fidelity_amount` default | Match new lib default | `src/maker_manager/mod.rs` — `Default for MakerConfig` (line 63) | Change `50000` → `10000` |
| Update `fidelity_timelock` default | Match new lib default | `src/maker_manager/mod.rs` — `Default for MakerConfig` (line 64) | Change `13104` → `15000` |
| Update `base_fee` default | Match new lib default | `src/maker_manager/mod.rs` — `Default for MakerConfig` (line 65) | Change `100` → `1000` |
| Update `amount_relative_fee_pct` default | Match new lib default | `src/maker_manager/mod.rs` — `Default for MakerConfig` (line 66) | Change `0.1` → `0.025` |
| Add `time_relative_fee_pct` default | New field needs a default value | `src/maker_manager/mod.rs` — `Default for MakerConfig` | Add `time_relative_fee_pct: 0.001` to the Default impl |
| Add `nostr_relays` default | New field needs a default value | `src/maker_manager/mod.rs` — `Default for MakerConfig` | Add `nostr_relays: vec![]` to the Default impl |
| Collapse `create_maker_internal` init branch | Remove the `if config.taproot { ... } else { ... }` block entirely and replace with a single unified init call | `src/maker_manager/mod.rs` `create_maker_internal` (lines 199–238) | Replace the entire taproot/legacy branch with a single `MakerServer::init(MakerServerConfig { data_dir, wallet_name, rpc_config, network_port, rpc_port, control_port, tor_auth_password, socks_port, zmq_addr, password, time_relative_fee_pct: config.time_relative_fee_pct, nostr_relays: config.nostr_relays.clone(), fidelity_amount: config.fidelity_amount, fidelity_timelock: config.fidelity_timelock, base_fee: config.base_fee, amount_relative_fee_pct: config.amount_relative_fee_pct, ..Default::default() })` call |
| Remove `MakerBehavior::Normal` argument | Behavior arg is test-only in new lib, not passed at init | `src/maker_manager/mod.rs` — inside the old `Maker::init(...)` call | Delete the `MakerBehavior::Normal` argument — `MakerServer::init` does not accept it |
| Update `spawn_maker` call | Pass unified type instead of legacy enum variant | `src/maker_manager/mod.rs` lines 217, 237 | Pass `Arc<MakerServer>` directly instead of wrapping in `MakerInner::Legacy` / `MakerInner::Taproot` |
| Confirm new field survival through normalize/update cycles | New fields must not be silently dropped when config is rewritten | `src/maker_manager/mod.rs` — config normalization and update paths | Trace `time_relative_fee_pct` and `nostr_relays` through every path that rewrites the config (create, update, normalize) and confirm they are preserved |

---

## 2. Backend — Maker Pool (`src/maker_manager/maker_pool.rs`)

| Task Name | Task Description | Code Site | Suggested Code Change |
|-----------|-----------------|-----------|----------------------|
| Update start-function import | Merged upstream — only one function now | `src/maker_manager/maker_pool.rs` line 11 | Replace `use coinswap::maker::{start_maker_server, start_maker_server_taproot};` with `use coinswap::maker::start_server;` |
| Update maker type import | Old types removed upstream | `src/maker_manager/maker_pool.rs` line 12 | Replace `use coinswap::maker::{Maker, TaprootMaker};` with `use coinswap::maker::MakerServer;` |
| Replace `MakerWalletAccess` impl for `Maker` | `Maker` type is gone — rewrite for unified type | `src/maker_manager/maker_pool.rs` lines 30–42 | Replace the entire impl block with `impl MakerWalletAccess for MakerServer { ... }`. Confirm `get_wallet()` and `get_data_dir()` method names still exist on `MakerServer` before writing — check upstream commit if unsure |
| Remove `MakerWalletAccess` impl for `TaprootMaker` | `TaprootMaker` type is gone | `src/maker_manager/maker_pool.rs` lines 44–56 | Delete the entire `impl MakerWalletAccess for TaprootMaker` block |
| Set `default_address_type()` to `P2TR` | Unified protocol is taproot-based | `src/maker_manager/maker_pool.rs` — `default_address_type()` in the new `MakerServer` impl | Return `AddressType::P2TR` |
| Remove `MakerHandle` enum | Enum exists only to support the old protocol split | `src/maker_manager/maker_pool.rs` lines 247–283 | Delete the `MakerHandle` enum with `Legacy(Arc<Maker>)` and `Taproot(Arc<TaprootMaker>)` variants. Replace with a plain `Arc<MakerServer>` (newtype wrapper or direct usage) everywhere `MakerHandle` was used |
| Simplify `MakerHandle::as_wallet_access()` | No more match needed | `src/maker_manager/maker_pool.rs` — `as_wallet_access()` method | Remove the match on Legacy/Taproot. Just deref `Arc<MakerServer>` directly |
| Simplify `MakerHandle::reset_shutdown()` | Single type — no match needed | `src/maker_manager/maker_pool.rs` lines 261–266 | Replace `match` on Legacy/Taproot with a single call on `MakerServer` |
| Simplify `MakerHandle::signal_shutdown()` | Single type — no match needed | `src/maker_manager/maker_pool.rs` lines 268–274 | Replace `match` on Legacy/Taproot with a single call on `MakerServer` |
| Simplify `MakerHandle::clone_inner()` | Single type — trivial clone | `src/maker_manager/maker_pool.rs` lines 276–282 | Replace `match` on Legacy/Taproot with `.clone()` on the `Arc<MakerServer>` |
| Collapse `start_server` match into single call | Both arms now do the same thing | `src/maker_manager/maker_pool.rs` lines 393–414 | Remove the match on `MakerHandle::Legacy` / `MakerHandle::Taproot`. Replace both arms with a single `start_server(maker.clone())` call |
| Rename spawned thread names | Thread names drive log routing — must match new naming | `src/maker_manager/maker_pool.rs` — thread spawn in `start_server` method | Change `"legacy-{id}"` and `"taproot-{id}"` to `"maker-{id}"` |
| Update `spawn_maker` signature | Accept unified type | `src/maker_manager/maker_pool.rs` — `spawn_maker` function signature | Change parameter from `MakerHandle` enum to `Arc<MakerServer>` |

---

## 3. Backend — Persistence (`src/maker_manager/persistence.rs`)

| Task Name | Task Description | Code Site | Suggested Code Change |
|-----------|-----------------|-----------|----------------------|
| Remove `taproot` from `StoredMakerConfig` | Field no longer part of the config model | `src/maker_manager/persistence.rs` — `StoredMakerConfig` struct | Delete the `taproot` field from the stored config struct |
| Add `time_relative_fee_pct` to `StoredMakerConfig` | New field must be persisted | `src/maker_manager/persistence.rs` — `StoredMakerConfig` struct | Add `time_relative_fee_pct: f64` field |
| Add `nostr_relays` to `StoredMakerConfig` | New field must be persisted | `src/maker_manager/persistence.rs` — `StoredMakerConfig` struct | Add `nostr_relays: Vec<String>` field |
| Add `required_confirms` to `StoredMakerConfig` | New upstream config field — store even if not exposed in UI | `src/maker_manager/persistence.rs` — `StoredMakerConfig` struct | Add `required_confirms: u32` field with a serde default of `1` |
| Update default helpers for changed values | Old configs loading without these fields should still produce sensible values | `src/maker_manager/persistence.rs` — default helper functions used by serde | Update helpers to return: `fidelity_amount` → `10000`, `fidelity_timelock` → `15000`, `base_fee` → `1000`, `amount_relative_fee_pct` → `0.025`. Add new helpers: `time_relative_fee_pct` → `0.001`, `nostr_relays` → `vec![]`, `required_confirms` → `1` |
| Tolerate legacy `taproot` field on load | Existing `makers.json` from pre-migration installs must still load | `src/maker_manager/persistence.rs` — deserialization of `StoredMakerConfig` | Use `#[serde(default)]` on the `taproot` field OR add `#[serde(rename = "taproot", skip_serializing)]` so old files load cleanly and the field is silently dropped on next save. Do not hard-fail on unknown fields. |

---

## 4. Backend — API DTOs (`src/api/dto.rs`)

| Task Name | Task Description | Code Site | Suggested Code Change |
|-----------|-----------------|-----------|----------------------|
| Remove `taproot` from `CreateMakerRequest` | Field gone from config | `src/api/dto.rs` line 24 | Delete `taproot: Option<bool>` from the struct |
| Add `time_relative_fee_pct` to `CreateMakerRequest` | New configurable field | `src/api/dto.rs` — `CreateMakerRequest` struct | Add `time_relative_fee_pct: Option<f64>` |
| Add `nostr_relays` to `CreateMakerRequest` | New configurable field | `src/api/dto.rs` — `CreateMakerRequest` struct | Add `nostr_relays: Option<Vec<String>>` |
| Remove `taproot` from `UpdateMakerConfigRequest` | Field gone from config | `src/api/dto.rs` line 62 | Delete `taproot: Option<bool>` from the struct |
| Add `time_relative_fee_pct` to `UpdateMakerConfigRequest` | New configurable field | `src/api/dto.rs` — `UpdateMakerConfigRequest` struct | Add `time_relative_fee_pct: Option<f64>` |
| Add `nostr_relays` to `UpdateMakerConfigRequest` | New configurable field | `src/api/dto.rs` — `UpdateMakerConfigRequest` struct | Add `nostr_relays: Option<Vec<String>>` |
| Remove `taproot` merge from `apply_to` | Field gone | `src/api/dto.rs` — `UpdateMakerConfigRequest::apply_to` (line 101) | Delete the `taproot: self.taproot...` line |
| Add `time_relative_fee_pct` merge in `apply_to` | New field needs merging on partial update | `src/api/dto.rs` — `UpdateMakerConfigRequest::apply_to` | Add `time_relative_fee_pct: self.time_relative_fee_pct.unwrap_or(base.time_relative_fee_pct)` |
| Add `nostr_relays` merge in `apply_to` | New field needs merging on partial update | `src/api/dto.rs` — `UpdateMakerConfigRequest::apply_to` | Add `nostr_relays: self.nostr_relays.unwrap_or(base.nostr_relays)` |
| Remove `taproot` from `MakerInfoDetailed` | Gone from response shape | `src/api/dto.rs` — `MakerInfoDetailed` struct (line 186) | Delete `taproot: bool` field |
| Add `time_relative_fee_pct` to `MakerInfoDetailed` | New field to surface in detail responses | `src/api/dto.rs` — `MakerInfoDetailed` struct | Add `time_relative_fee_pct: f64` |
| Remove `taproot` from `From<ManagerMakerInfo>` | Gone from mapping | `src/api/dto.rs` — `From<ManagerMakerInfo> for MakerInfoDetailed` (line 207) | Delete `taproot: info.config.taproot` line |
| Add `time_relative_fee_pct` to `From<ManagerMakerInfo>` | New field mapping | `src/api/dto.rs` — `From<ManagerMakerInfo> for MakerInfoDetailed` | Add `time_relative_fee_pct: info.config.time_relative_fee_pct` |
| Update `fidelity_amount` schema example | Match new default | `src/api/dto.rs` — `#[schema(example = 50000)]` on `fidelity_amount` in `CreateMakerRequest` (line 38) | Change to `#[schema(example = 10000)]` |
| Update `base_fee` schema example | Match new default | `src/api/dto.rs` — `#[schema(example = 100)]` on `base_fee` (line 42) | Change to `#[schema(example = 1000)]` |
| Update `amount_relative_fee_pct` schema example | Match new default | `src/api/dto.rs` — `#[schema(example = 0.1)]` on `amount_relative_fee_pct` (line 44) | Change to `#[schema(example = 0.025)]` |

---

## 5. Backend — API Handler (`src/api/makers.rs`)

| Task Name | Task Description | Code Site | Suggested Code Change |
|-----------|-----------------|-----------|----------------------|
| Remove `taproot` from maker creation handler | Create endpoint still maps `taproot` into the old config — DTO change alone is not enough | `src/api/makers.rs` — create maker route handler | Remove any reference to `request.taproot` or mapping it into `MakerConfig`. The field no longer exists on either side. |
| Update config construction in create handler | Handler must build config with new fields and new defaults | `src/api/makers.rs` — config struct construction in the create handler | Use `MakerConfig { time_relative_fee_pct: request.time_relative_fee_pct.unwrap_or(0.001), nostr_relays: request.nostr_relays.unwrap_or_default(), fidelity_amount: request.fidelity_amount.unwrap_or(10000), base_fee: request.base_fee.unwrap_or(1000), amount_relative_fee_pct: request.amount_relative_fee_pct.unwrap_or(0.025), ..Default::default() }` |

---

## 6. Backend — Log Writer (`src/utils/log_writer.rs`)

| Task Name | Task Description | Code Site | Suggested Code Change |
|-----------|-----------------|-----------|----------------------|
| Update thread-name parser to support unified naming | Per-maker log routing breaks if thread names change but the parser does not | `src/utils/log_writer.rs` — section that extracts maker id from thread name | Replace pattern matching on `"legacy-"` or `"taproot-"` prefixes with a match on `"maker-"` prefix. If the parser uses a regex, update the pattern accordingly. If it uses string splitting, update the prefix constant. |

---

## 7. Frontend — Shared API Types (`frontend/app/api.ts`)

| Task Name | Task Description | Code Site | Suggested Code Change |
|-----------|-----------------|-----------|----------------------|
| Remove `taproot` from `MakerInfoDetailed` | Field gone from backend response | `frontend/app/api.ts` — `MakerInfoDetailed` interface (line 25) | Delete `taproot: boolean` |
| Add `time_relative_fee_pct` to `MakerInfoDetailed` | New field returned in detail responses | `frontend/app/api.ts` — `MakerInfoDetailed` interface | Add `time_relative_fee_pct: number` |
| Remove `taproot` from `CreateMakerRequest` | Field gone from create payload | `frontend/app/api.ts` — `CreateMakerRequest` interface (line 139) | Delete `taproot?: boolean` |
| Add `time_relative_fee_pct` to `CreateMakerRequest` | New optional create field | `frontend/app/api.ts` — `CreateMakerRequest` interface | Add `time_relative_fee_pct?: number` |
| Add `nostr_relays` to `CreateMakerRequest` | New optional create field | `frontend/app/api.ts` — `CreateMakerRequest` interface | Add `nostr_relays?: string[]` |
| Remove `taproot` from `UpdateMakerConfigRequest` | Field gone from update payload | `frontend/app/api.ts` — `UpdateMakerConfigRequest` interface (line 160) | Delete `taproot?: boolean` |
| Add `time_relative_fee_pct` to `UpdateMakerConfigRequest` | New optional update field | `frontend/app/api.ts` — `UpdateMakerConfigRequest` interface | Add `time_relative_fee_pct?: number` |
| Add `nostr_relays` to `UpdateMakerConfigRequest` | New optional update field | `frontend/app/api.ts` — `UpdateMakerConfigRequest` interface | Add `nostr_relays?: string[]` |

---

## 8. Frontend — Onboarding (`frontend/app/routes/onboarding.tsx`)

| Task Name | Task Description | Code Site | Suggested Code Change |
|-----------|-----------------|-----------|----------------------|
| Remove `taproot` from form initial state | Field no longer exists | `frontend/app/routes/onboarding.tsx` — `form` initial state (line 459) | Delete `taproot: true` from the initial state object |
| Remove taproot toggle UI | Control is now dead | `frontend/app/routes/onboarding.tsx` — taproot toggle/checkbox in `CreateStep` render | Delete the toggle element and any surrounding label or explanatory copy |
| Remove `taproot` from `handleCreate` payload | Field gone from `CreateMakerRequest` | `frontend/app/routes/onboarding.tsx` — `body` object in `handleCreate` (line 503) | Delete `taproot: form.taproot` from the request body |

---

## 9. Frontend — Add Maker (`frontend/app/routes/addMaker.tsx`)

| Task Name | Task Description | Code Site | Suggested Code Change |
|-----------|-----------------|-----------|----------------------|
| Remove `taproot` from form state | Field no longer exists | `frontend/app/routes/addMaker.tsx` — form state initialisation | Delete `taproot` from the form state object |
| Remove taproot toggle UI | Control is now dead | `frontend/app/routes/addMaker.tsx` — taproot checkbox or toggle in the form | Delete the toggle element and any surrounding label or copy |
| Remove `taproot` from submit payload | Field gone from `CreateMakerRequest` | `frontend/app/routes/addMaker.tsx` — request body in the submit handler | Delete any `taproot: ...` line from the payload object |

---

## 10. Frontend — Maker Settings (`frontend/app/routes/makerDetails/settings.tsx`)

| Task Name | Task Description | Code Site | Suggested Code Change |
|-----------|-----------------|-----------|----------------------|
| Stop reading `info.taproot` | Field will be absent from API response | `frontend/app/routes/makerDetails/settings.tsx` — state initialisation from API response | Remove any `taproot: info.taproot` or similar assignment |
| Remove taproot toggle control | Control becomes non-functional after migration | `frontend/app/routes/makerDetails/settings.tsx` — protocol toggle UI | Delete the taproot toggle element and its label |
| Remove `taproot` from save payload | Field gone from `UpdateMakerConfigRequest` | `frontend/app/routes/makerDetails/settings.tsx` — update request body | Delete any `taproot` line from the payload |
| Update displayed defaults in settings inputs | Users should see defaults that match backend reality | `frontend/app/routes/makerDetails/settings.tsx` — placeholder/default values in inputs | Update placeholders: `fidelity_amount` → `10000`, `base_fee` → `1000`, `amount_relative_fee_pct` → `0.025`, `fidelity_timelock` → `15000` |
| Load `time_relative_fee_pct` from API response | New field returned by backend | `frontend/app/routes/makerDetails/settings.tsx` — state initialisation | Add `time_relative_fee_pct: info.time_relative_fee_pct` to local state |
| Add `time_relative_fee_pct` to save payload | New field must round-trip through settings | `frontend/app/routes/makerDetails/settings.tsx` — update request body | Add `time_relative_fee_pct: state.time_relative_fee_pct` to the payload |

---

## 11. Frontend — Maker Dashboard (`frontend/app/routes/makerDetails/dashboard.tsx`)

| Task Name | Task Description | Code Site | Suggested Code Change |
|-----------|-----------------|-----------|----------------------|
| Remove Taproot status card | Card is misleading once all makers are unified | `frontend/app/routes/makerDetails/dashboard.tsx` — summary card area | Delete the Taproot status card element |
| Replace with a fee/config summary card | Prevents leaving a dead spot in the layout | `frontend/app/routes/makerDetails/dashboard.tsx` — card area where taproot card was | Add a new card showing relevant runtime info — e.g. `base_fee`, `time_relative_fee_pct`, and `fidelity_amount` from the maker's config |

---

## 12. Frontend — Setup Screen (`frontend/app/routes/makersetup.tsx`)

| Task Name | Task Description | Code Site | Suggested Code Change |
|-----------|-----------------|-----------|----------------------|
| Remove taproot-specific log string checks | Log lines are no longer emitted by the unified lib | `frontend/app/routes/makersetup.tsx` — `makerLive()` function (lines 46, 48, 50) | Delete the three checks for `"Taproot swap liquidity ready"`, `"Taproot maker setup completed"`, and `"Taproot maker server listening on port"` |
| Keep generic log string checks | These are the only lines the unified lib will emit | `frontend/app/routes/makersetup.tsx` — `makerLive()` function | Retain `"swap liquidity ready"`, `"maker setup completed"`, and `"maker server listening on port"` checks. Consider making matching case-insensitive or substring-based so minor upstream wording changes don't break setup detection |
| Verify exact `MakerServer` setup log lines | The exact strings emitted at startup need to be confirmed before finalising this file | `frontend/app/routes/makersetup.tsx` | Check the upstream commit or run the unified lib locally to confirm the precise log output strings. Update checks to match exactly. |

---

## 13. Frontend — Log Viewer (`frontend/app/routes/makerDetails/log.tsx`)

| Task Name | Task Description | Code Site | Suggested Code Change |
|-----------|-----------------|-----------|----------------------|
| Update comments and examples referencing taproot thread names | Developer-facing notes should match real logs after migration | `frontend/app/routes/makerDetails/log.tsx` — inline comments and example strings | Replace any `taproot-*` or `legacy-*` thread name references in comments and example strings with `maker-*` |
| Confirm no UI logic depends on old thread name format | Subtle log viewer regressions are possible if parsing is entangled with thread name format | `frontend/app/routes/makerDetails/log.tsx` — any filtering or parsing logic | Audit the file for runtime logic (not just comments) that pattern-matches on `legacy-` or `taproot-`. If found, update to match `maker-{id}` format. |

---

## 14. Verification

| Task Name | Task Description | Code Site | Suggested Code Change |
|-----------|-----------------|-----------|----------------------|
| Rust format check | Required by repo workflow | Repo root | Run `cargo fmt` and commit any formatting changes |
| Frontend format check | Required by repo workflow | `frontend/` | Run `cd frontend && npx prettier --write .` and commit |
| Rust build | Confirms type and import migration is complete | Repo root | Run `cargo build` — must compile cleanly against the updated coinswap lib |
| Frontend build | Catches DTO and UI drift | `frontend/` | Run `cd frontend && npm run build` — must compile with no TypeScript errors |
| API tests | Maker endpoints must still behave correctly | Repo root | Run `cargo test --test api` |
| Manual create flow (onboarding) | Verify onboarding path sends no taproot field | Running app | Create a maker through the onboarding flow and confirm it succeeds with no `taproot`-related error |
| Manual create flow (add-maker) | Verify add-maker path sends no taproot field | Running app | Create a maker through the add-maker screen and confirm it succeeds |
| Manual settings flow | Config update path must survive the new shape | Running app | Edit maker config in the settings screen and save — confirm restart/re-init works correctly |
| Manual setup flow | Setup screen must reach live state using new log lines | Running app | Create and start a maker, watch the setup screen progress to live state using generic log lines |
| Persistence upgrade test | Existing `makers.json` from pre-migration installs must still load | Local test | Copy a pre-migration `makers.json` into the data dir and start the app — confirm all makers load correctly without errors, and that the `taproot` field is silently dropped on next save |

---

## Open Questions (resolve before or during implementation)

| # | Question | Impact |
|---|---|---|
| 1 | What exact log lines does `MakerServer` emit when setup completes? | `makersetup.tsx` log parsing depends on these strings — verify against the upstream commit before finalising section 12 |
| 2 | Does `MakerServer` still expose `get_wallet()` and `get_data_dir()` with the same method names? | `MakerWalletAccess` impl in `maker_pool.rs` depends on this — check upstream before rewriting the impl |
| 3 | Should `nostr_relays` be exposed in the settings UI now, or backend-only for this migration? | Affects section 10 scope — recommendation is backend-only for now, UI deferred |
| 4 | Should `required_confirms` be exposed in the settings UI? | Low priority — default of `1` is fine; backend-only for now |
