#!/usr/bin/env python3
"""Tail maker-dashboard's journald output, collect WARN/ERROR lines over a
short window, and forward the batch as a single Matrix message with the
lines in a code block.

Run as root via systemd (see maker-dashboard-forwarder.service).
Persists a journald cursor so restarts don't repeat or miss entries.

Env knobs:
  FORWARDER_UNIT     systemd unit to tail (default: maker-dashboard.service)
  FORWARDER_CURSOR   cursor file path (default: provided by StateDirectory=)
  LEVELS             comma-separated levels to forward (default: WARN,ERROR)
  BATCH_WINDOW_SEC   flush batch every N seconds (default: 30)
  MAX_BATCH_LINES    cap lines per batch; excess counted as overflow (default: 50)
  DEDUPE_WINDOW_SEC  suppress identical messages within window (default: 300)
  NOTIFY_CMD         path to notifier (default: /usr/local/bin/notify-matrix.sh)
"""
import os
import re
import socket
import subprocess
import sys
import threading
import time
from html import escape as html_escape

UNIT = os.environ.get("FORWARDER_UNIT", "maker-dashboard.service")
CURSOR_FILE = os.environ.get(
    "FORWARDER_CURSOR",
    "/var/lib/maker-dashboard-forwarder/forwarder.cursor",
)
LEVELS = {
    lvl.strip().upper()
    for lvl in os.environ.get("LEVELS", "WARN,ERROR,INFO").split(",")
    if lvl.strip()
}
BATCH_WINDOW = int(os.environ.get("BATCH_WINDOW_SEC", "30"))
MAX_BATCH_LINES = int(os.environ.get("MAX_BATCH_LINES", "50"))
DEDUPE_WINDOW = int(os.environ.get("DEDUPE_WINDOW_SEC", "300"))
NOTIFY_CMD = os.environ.get("NOTIFY_CMD", "/usr/local/bin/notify-matrix.sh")

ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
# Two log shapes the dashboard emits to stdout, both worth forwarding:
#
# 1. tracing-subscriber fmt output (Rust app logs), with target on or off:
#      <ISO-ts>  <LEVEL> <target>: <message>
#      <ISO-ts>  <LEVEL> <thread>  <message>
LINE_RE = re.compile(r"^\S+\s+(WARN|ERROR|INFO|DEBUG|TRACE)\s+([^\s:]+):?\s+(.*)$")
#
# 2. embedded Tor (libtor) writes its own format on the same stdout:
#      May 31 02:03:59.870 [warn] ControlPort is open...
#      May 31 02:04:00.000 [notice] Bootstrapped 5% (conn)...
TOR_RE = re.compile(
    r"^\w+\s+\d+\s+[\d:.]+\s+\[(notice|warn|err|info|debug)\]\s+(.*)$"
)
# Map Tor levels to the same set tracing uses so the LEVELS filter applies
# uniformly. Tor's "notice" is roughly INFO; its "info" is very chatty,
# closer to DEBUG.
TOR_LEVEL_MAP = {
    "err": "ERROR",
    "warn": "WARN",
    "notice": "INFO",
    "info": "DEBUG",
    "debug": "TRACE",
}
# Rust panics are written by the runtime's panic handler without a tracing
# prefix; they begin with this distinctive line. Treat them as ERROR events
# so the panic message + backtrace lines that follow are kept together.
PANIC_RE = re.compile(r"^thread '.*' panicked at ")

# A line that doesn't match anything above is treated as a CONTINUATION of
# the currently-pending event (anyhow Caused-by, backtrace, etc.). Without
# this, multi-line content is silently dropped.

HOST = socket.gethostname()

# (level, message_body) -> (last_sent_ts, suppressed_count)
_state = {}
# Pending multi-line event being accumulated. None if no event is in flight.
#   {"level": str, "message": str, "lines": [str], "last_line_at": float}
_pending = None
# Pending lines for the current window. Each entry is one event's text
# (possibly multi-line).
_batch = []
# How many events we dropped because the batch hit MAX_BATCH_LINES.
_overflow = 0
_lock = threading.Lock()


def log(msg):
    print(f"[forwarder] {msg}", file=sys.stderr, flush=True)


def _parse_event(line):
    """If `line` starts a new log event, return (level, message). Else None."""
    m = LINE_RE.match(line)
    if m:
        return m.group(1), m.group(3)
    m = TOR_RE.match(line)
    if m:
        return TOR_LEVEL_MAP.get(m.group(1), "INFO"), m.group(2)
    if PANIC_RE.match(line):
        return "ERROR", line
    return None


def _commit_pending_locked():
    """Apply LEVELS filter and dedup; enqueue the pending event to the batch.
    Must be called with _lock held. Resets _pending to None.
    """
    global _pending, _overflow
    p = _pending
    _pending = None
    if p is None:
        return
    if p["level"] not in LEVELS:
        return

    key = (p["level"], p["message"])
    now = time.time()
    last_ts, suppressed = _state.get(key, (0, 0))
    if now - last_ts < DEDUPE_WINDOW:
        # Identical first-line seen recently: count, but don't re-emit the
        # whole multi-line block.
        _state[key] = (last_ts, suppressed + 1)
        return
    _state[key] = (now, 0)

    text = "\n".join(p["lines"])
    if suppressed:
        text += f"\n(+{suppressed} previously suppressed)"

    if len(_batch) >= MAX_BATCH_LINES:
        _overflow += 1
        return
    _batch.append(text)


def process_line(raw):
    """Feed one line from journald into the accumulator.

    Lines that match a known event format (tracing, Tor, panic) start a new
    pending event, committing whatever was previously pending. Lines that
    don't match are attached to the current pending event as continuations
    (Caused-by chain, backtrace, etc.).
    """
    global _pending
    line = ANSI_RE.sub("", raw).rstrip()
    if not line:
        return

    parsed = _parse_event(line)
    with _lock:
        if parsed is not None:
            if _pending is not None:
                _commit_pending_locked()
            level, message = parsed
            _pending = {
                "level": level,
                "message": message,
                "lines": [line],
                "last_line_at": time.time(),
            }
        else:
            if _pending is not None:
                _pending["lines"].append(line)
                _pending["last_line_at"] = time.time()
            # else: orphan continuation before any event start — drop.


def send_batch(lines, overflow):
    n = len(lines)
    title_plain = f"[maker-dashboard] {n} event{'s' if n != 1 else ''} on {HOST}"
    if overflow:
        title_plain += f"  (+{overflow} dropped)"
    body_plain = "\n".join(lines)
    plain = f"{title_plain}\n{body_plain}"

    overflow_html = (
        f' <em>(+{overflow} dropped)</em>' if overflow else ""
    )
    html = (
        f"<strong>[maker-dashboard]</strong> {n} event"
        f"{'s' if n != 1 else ''} on <code>{html_escape(HOST)}</code>"
        f"{overflow_html}"
        f"<br/><pre><code>{html_escape(body_plain)}</code></pre>"
    )

    try:
        subprocess.run([NOTIFY_CMD, plain, html], check=False, timeout=20)
    except subprocess.TimeoutExpired:
        log(f"notify timed out on batch of {n}")
    except Exception as e:
        log(f"notify error: {e}")


def flush_loop():
    global _batch, _overflow
    while True:
        time.sleep(BATCH_WINDOW)
        with _lock:
            # If a pending event has been quiet for >1s, assume its
            # continuations are done and commit it before flushing the batch.
            if _pending is not None and (time.time() - _pending["last_line_at"]) > 1.0:
                _commit_pending_locked()
            if not _batch:
                continue
            batch_copy = _batch
            overflow = _overflow
            _batch = []
            _overflow = 0
        send_batch(batch_copy, overflow)


def main():
    os.makedirs(os.path.dirname(CURSOR_FILE), exist_ok=True)
    cmd = [
        "journalctl",
        "-u", UNIT,
        "--follow",
        "--cursor-file", CURSOR_FILE,
        "--lines=0",
        "--no-pager",
        "-o", "cat",
    ]
    log(f"tailing {UNIT}; levels={sorted(LEVELS)}; window={BATCH_WINDOW}s; "
        f"max-lines/batch={MAX_BATCH_LINES}; dedupe={DEDUPE_WINDOW}s")

    threading.Thread(target=flush_loop, daemon=True).start()

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True, bufsize=1)
    try:
        for line in proc.stdout:
            process_line(line)
    except KeyboardInterrupt:
        pass
    finally:
        # Best-effort final flush so we don't lose the in-flight window.
        # Force-commit any pending event regardless of idle time — we're
        # shutting down, no more continuations are coming.
        with _lock:
            if _pending is not None:
                _commit_pending_locked()
            batch_copy = _batch
            overflow = _overflow
        if batch_copy:
            send_batch(batch_copy, overflow)
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    main()
