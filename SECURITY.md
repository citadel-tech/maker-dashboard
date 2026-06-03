# Security

## Authentication

The dashboard is protected by a password that you choose on first run. The password is
hashed with **Argon2id** and stored in `~/.config/maker-dashboard/auth.json`. On
subsequent starts you log in via the browser; a valid session is required for every
`/api/*` route.

Once logged in, the browser holds a session cookie (`HttpOnly`, `Secure`,
`SameSite=Strict`, 24 h expiry). All `/api/*` routes reject requests without a
valid session with HTTP 401.

### First-run setup

On a fresh install (no `auth.json` present), `/setup` is reachable and accepts a
password to initialize the dashboard. The chosen password is hashed with Argon2id and
the AES-256-GCM key for `makers.json` is derived from it using a separate Argon2id-
derived 32-byte salt. Once `auth.json` exists, `/setup` returns 409, only `/login` works.

`/setup` also refuses if `makers.json` is already on disk: that combination (no
`auth.json` but encrypted `makers.json` present) means the operator's encryption key
has been lost and silently overwriting it would lock them out of existing data. Restore
`auth.json` from backup, or explicitly delete `makers.json` to start fresh.

There is intentionally no token gating `/setup`. Before initialization there is no user
data to protect: if a hostile party on the network races the operator and completes
setup first, the recovery is to stop the server, delete `auth.json`, and run setup
again. To prevent races on multi-tenant or network-exposed hosts, restrict access to
the dashboard port until setup is complete (e.g. keep `--allow-remote` off, or use a
firewall rule).

## Encrypted storage

Maker configs, including Bitcoin Core RPC credentials, wallet passwords, and Tor auth
tokens, are stored encrypted at rest in `~/.config/maker-dashboard/makers.json`. The
encryption key is derived from your password using Argon2id with a separate salt, so the
file is opaque without the password. The file is written with mode `0600`.

`~/.config/maker-dashboard/auth.json` stores only the argon2id password hash and the
two key-derivation salts, no plaintext credentials of any kind.

To change your password, use the **Change password** button in the dashboard nav bar,
which calls `POST /api/auth/rotate-password`. The endpoint atomically re-encrypts
`makers.json` with the new key and updates `auth.json` in a single operation. The
new password takes effect immediately for the current session and on subsequent
logins; no restart or env-var update is required.

## Localhost-only access

When you are using `--allow-remote=false`, the dashboard would bind to `127.0.0.1` and a middleware rejects every request
whose source IP is not a loopback address, providing defence-in-depth on top of the
password layer. But by default, it allows non-Localhost requests without issues. This is an additional security layer if you want.

You may be able to access the dashboard if you use this option and run it inside a docker container. You will need to run it on the host network and may face a lot of issues with non-linux systems like [MacOS](https://forums.docker.com/t/enabling-network-host-on-macos/150379).

## Hot wallet

Each maker holds a hot wallet. Private keys are stored unencrypted on disk under
`~/.coinswap/{id}/wallets/`. Anyone with read access to those files can sweep the wallet.
Secure the directory with appropriate filesystem permissions and treat that path like any
other hot wallet.

You can set a wallet password at creation time via the `password` field in the creation
request. When set, the coinswap library encrypts the wallet file at rest.

Back up the wallet files before making configuration changes or upgrading.

## Fidelity bond timelock

The fidelity bond is a time-locked Bitcoin output. The funds are unspendable until the
timelock expires (the default is ~3 months). Deleting a maker from the dashboard does
not reclaim those funds. it only removes the dashboard registration. The locked output
stays on-chain and must be swept manually after the timelock expires using the wallet's
seed or a backup.

Before deleting a maker, check the remaining timelock via `GET /api/makers/{id}/fidelity`
and make sure you have a wallet backup or the seed phrase stored safely.

## Reporting vulnerabilities

Please report security issues privately to the maintainers via the
[GitHub Security Advisories](https://github.com/citadel-tech/maker-dashboard/security/advisories/new)
page rather than opening a public issue.
