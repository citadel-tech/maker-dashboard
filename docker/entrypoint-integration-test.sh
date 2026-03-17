#!/bin/sh
set -e

# Start nostr-rs-relay in the background
/root/.nostr-relay-bin/nostr-rs-relay \
    --config /etc/nostr-relay/config.toml \
    > /tmp/nostr-relay.log 2>&1 &

# Wait up to 20 s for the relay to accept connections
echo "[entrypoint] Waiting for nostr relay on 127.0.0.1:8000 ..."
i=0
while ! nc -z 127.0.0.1 8000; do
    i=$((i + 1))
    if [ "$i" -ge 40 ]; then
        echo "[entrypoint] Relay failed to start. Logs:"
        cat /tmp/nostr-relay.log
        exit 1
    fi
    sleep 0.5
done
echo "[entrypoint] Nostr relay is up"

exec cargo test --test integration_test --features integration-test -- --nocapture
