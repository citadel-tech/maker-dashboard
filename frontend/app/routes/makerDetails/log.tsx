import { useState, useEffect, useMemo, useRef } from "react";
import { Circle } from "lucide-react";
import { monitoring, streamLogs, downloadLogs } from "../../api";

interface Props {
  id: string;
}

type Level = "ALL" | "INFO" | "WARN" | "ERROR" | "DEBUG" | "TRACE";

const LEVELS: Level[] = ["ALL", "INFO", "WARN", "ERROR", "DEBUG", "TRACE"];

// Strips tracing span context like `maker_server{maker_id=946 kind="maker"}: `
const SPAN_CONTEXT_RE = / \w+\{[^}]*\}:/g;

interface ParsedLine {
  time: string;
  level: Exclude<Level, "ALL">;
  thread: string;
  message: string;
}

// Parses: `2026-03-19T17:04:23.045147Z  INFO          maker-947 message…`
const LINE_RE =
  /^(\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})\.\d+Z)\s+(INFO|WARN|ERROR|DEBUG|TRACE)\s+(\S+)\s+(.*)/s;

function parse(raw: string): ParsedLine | null {
  const m = raw.match(LINE_RE);
  if (!m) return null;
  return {
    time: m[2],
    level: m[3] as Exclude<Level, "ALL">,
    thread: m[4],
    message: m[5].replace(SPAN_CONTEXT_RE, "").trim(),
  };
}

const LEVEL_COLOR: Record<Exclude<Level, "ALL">, string> = {
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
  DEBUG: "debug",
  TRACE: "trace",
};

const MSG_COLOR: Record<Exclude<Level, "ALL">, string> = {
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
  DEBUG: "debug",
  TRACE: "trace",
};

const FILTER_STYLES: Record<Level, string> = {
  ALL: "bg-white text-black",
  INFO: "bg-blue-600 text-white",
  WARN: "bg-yellow-500 text-black",
  ERROR: "bg-red-600 text-white",
  DEBUG: "bg-gray-600 text-white",
  TRACE: "bg-purple-600 text-white",
};

export default function Logs({ id }: Props) {
  const [logs, setLogs] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState<Level>("ALL");
  const logsEndRef = useRef<HTMLDivElement>(null);
  const initialLoadedRef = useRef(false);

  useEffect(() => {
    monitoring
      .dataDir(id)
      .then(setDataDir)
      .catch(() => {});

    const requestToken = { isValid: true };
    const bufferedLines: string[] = [];

    const stop = streamLogs(id, (line) => {
      if (requestToken.isValid) {
        bufferedLines.push(line);
        if (initialLoadedRef.current) {
          setLogs((prev) => [...prev, line].slice(-100));
        }
      }
    });
    setStreaming(true);

    monitoring
      .logs(id, 100)
      .then((initialLines) => {
        if (requestToken.isValid) {
          setLogs([...initialLines, ...bufferedLines].slice(-100));
          initialLoadedRef.current = true;
        }
      })
      .catch(() => {});

    return () => {
      requestToken.isValid = false;
      stop();
      setStreaming(false);
    };
  }, [id]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const logPath = dataDir ? `${dataDir}/debug.log` : null;

  function copyPath() {
    if (!logPath) return;
    navigator.clipboard
      .writeText(logPath)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  const counts = useMemo(
    () =>
      logs.reduce<Record<string, number>>((acc, raw) => {
        const p = parse(raw);
        if (p) acc[p.level] = (acc[p.level] ?? 0) + 1;
        return acc;
      }, {}),
    [logs],
  );

  const visibleLogs = useMemo(
    () =>
      filter === "ALL"
        ? logs
        : logs.filter((raw) => parse(raw)?.level === filter),
    [filter, logs],
  );

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold">Logs</h3>
            <span className="text-xs text-gray-500">last 100 lines</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => downloadLogs(id)}
              className="cs-log-action"
            >
              Download
            </button>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                streaming
                  ? "bg-green-900 text-green-300"
                  : "bg-gray-800 text-gray-400"
              }`}
            >
              {streaming ? (
                <>
                  <Circle className="w-2 h-2 fill-current inline-block mr-1" />{" "}
                  Live
                </>
              ) : (
                "Static"
              )}
            </span>
          </div>
        </div>

        {/* Filter bar */}
        <div className="cs-log-filters">
          {LEVELS.map((lvl) => {
            const active = filter === lvl;
            const count = lvl === "ALL" ? logs.length : (counts[lvl] ?? 0);
            return (
              <button
                key={lvl}
                type="button"
                onClick={() => setFilter(lvl)}
                className={`cs-log-filter ${
                  active
                    ? FILTER_STYLES[lvl]
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
              >
                {lvl}
                <span
                  className={`ml-1.5 ${active ? "opacity-80" : "text-gray-500"}`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Log lines */}
        <div className="cs-log-console">
          {visibleLogs.length === 0 ? (
            <div className="text-gray-500">
              {logs.length === 0 ? "No logs yet…" : "No matching log lines."}
            </div>
          ) : (
            visibleLogs.map((raw, i) => {
              const p = parse(raw);
              if (!p) {
                return (
                  <div key={i} className="text-gray-600 leading-5 break-all">
                    {raw.replace(SPAN_CONTEXT_RE, "")}
                  </div>
                );
              }
              return (
                <div key={i} className="flex gap-2 leading-5 min-w-0">
                  <span className="cs-log-time">{p.time}</span>
                  <span
                    className={`cs-log-level ${LEVEL_COLOR[p.level]}`}
                    data-level={p.level}
                  >
                    {p.level}
                  </span>
                  <span className="cs-log-thread">{p.thread}</span>
                  <span
                    className={`cs-log-message ${MSG_COLOR[p.level]}`}
                    data-level={p.level}
                  >
                    {p.message}
                  </span>
                </div>
              );
            })
          )}
          <div ref={logsEndRef} />
        </div>
      </div>

      {logPath && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-gray-500 mb-0.5">Log file</p>
            <p className="text-xs font-mono text-gray-300 truncate">
              {logPath}
            </p>
          </div>
          <button
            type="button"
            onClick={copyPath}
            className="cs-log-action shrink-0"
          >
            {copied ? "Copied!" : "Copy path"}
          </button>
        </div>
      )}
    </div>
  );
}
