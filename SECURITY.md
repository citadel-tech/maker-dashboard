# Security

## Localhost-only access

By default the dashboard binds to `127.0.0.1` and a middleware rejects every request
whose source IP is not a loopback address. This means the dashboard is only reachable
from the machine it is running on, even if the port is not firewalled.

This protection is bypassed the moment you set `--allow-remote` or
`DASHBOARD_ALLOW_REMOTE=true`. There is no built-in authentication, so enabling remote
access without putting a reverse proxy in front exposes full control of your maker nodes
and wallets to anyone who can reach the port. If you need remote access, place the
dashboard behind a reverse proxy that enforces TLS and authentication (e.g. HTTP Basic
Auth or mutual TLS) before forwarding to it.

## Hot wallet

Each maker holds a hot wallet. private keys are stored unencrypted on disk under
`~/.coinswap/{id}/wallets/`. Anyone with read access to those files can sweep the wallet.
Secure the directory with appropriate filesystem permissions and treat that path like any
other hot wallet on the machine.

You can set a wallet password at creation time via the `password` field in the creation
request. When set, the coinswap library encrypts the wallet file at rest.

Back up the wallet files before making configuration changes or upgrading. A botched
config update can leave the maker unable to start, and without a backup the funds in that
wallet would require manual recovery.

## Fidelity bond timelock

The fidelity bond is a time-locked Bitcoin output. The funds are unspendable until the
timelock expires (the default is 13,104 blocks, roughly 3 months). Deleting a maker from
the dashboard does not reclaim those funds. it only removes the dashboard registration.
The locked output stays on-chain and must be swept manually after the timelock expires
using the wallet's seed or backup.

Before deleting a maker, check the remaining timelock via `GET /api/makers/{id}/fidelity`
and make sure you have a wallet backup or the seed phrase stored safely.

## RPC credentials in storage

Maker configs, including Bitcoin Core RPC credentials, are stored in plaintext at
`~/.config/maker-dashboard/makers.json`. Restrict read access to that file to the user
running the dashboard process.

## Reporting vulnerabilities

Please report security issues privately to the maintainers via the
[GitHub Security Advisories](https://github.com/citadel-tech/maker-dashboard/security/advisories/new)
page rather than opening a public issue.
