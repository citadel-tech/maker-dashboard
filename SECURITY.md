# Security

## Authentication

The dashboard requires a password on every startup. On the first run the password is
hashed with **argon2id** and stored in `~/.config/maker-dashboard/auth.json`. On
subsequent runs the supplied password is verified against the stored hash; a wrong
password causes an immediate exit.

Set the password via environment variable:

```sh
DASHBOARD_PASSWORD=yourpassword maker-dashboard
```

For Docker or systemd, use a secrets file:

```sh
# write the password once
echo "yourpassword" > /run/secrets/dashboard_password
chmod 600 /run/secrets/dashboard_password

# point the dashboard at it
DASHBOARD_PASSWORD_FILE=/run/secrets/dashboard_password maker-dashboard
```

Once logged in, the browser holds a session cookie (`HttpOnly`, `Secure`,
`SameSite=Strict`, 24 h expiry). All `/api/*` routes reject requests without a
valid session with HTTP 401.

## Encrypted storage

Maker configs, including Bitcoin Core RPC credentials, wallet passwords, and Tor auth
tokens, are stored encrypted at rest in `~/.config/maker-dashboard/makers.json`. The
encryption key is derived from your password using Argon2id with a separate salt, so the
file is opaque without the password. The file is written with mode `0600`.

`~/.config/maker-dashboard/auth.json` stores only the argon2id password hash and the
two key-derivation salts, no plaintext credentials of any kind.

To change your password, use the **Change password** button in the dashboard nav bar.
The `POST /api/auth/rotate-password` endpoint atomically re-encrypts `makers.json` with
the new key and updates `auth.json` in a single operation. After rotating, update your
`DASHBOARD_PASSWORD` environment variable (or password file) before restarting — the
dashboard verifies the env var against `auth.json` on startup.

## Localhost-only access

By default the dashboard binds to `127.0.0.1` and a middleware rejects every request
whose source IP is not a loopback address, providing defence-in-depth on top of the
password layer.

This restriction is lifted when you set `--allow-remote` or `DASHBOARD_ALLOW_REMOTE=true`.
When running remotely, place the dashboard behind a reverse proxy that enforces TLS
before forwarding to it, so the session cookie and password are never sent in cleartext.

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
