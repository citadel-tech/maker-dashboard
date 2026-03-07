import { useState, useEffect, useRef } from "react";
import { monitoring, streamLogs } from "../../api";

interface Props {
  id: string;
}

export default function Logs({ id }: Props) {
  const [logs, setLogs] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Fetch historical lines first
    monitoring
      .logs(id, 100)
      .then((lines) => setLogs(lines))
      .catch(() => {});

    // Then stream new lines live
    const stop = streamLogs(id, (line) =>
      setLogs((prev) => [...prev.slice(-499), line])
    );
    setStreaming(true);

    return () => {
      stop();
      setStreaming(false);
    };
  }, [id]);

  // Auto-scroll to bottom on new lines
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Logs</h3>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            streaming
              ? "bg-green-900 text-green-300"
              : "bg-gray-800 text-gray-400"
          }`}
        >
          {streaming ? "● Live" : "Static"}
        </span>
      </div>
      <div className="bg-black rounded-lg p-4 font-mono text-xs sm:text-sm space-y-0.5 max-h-[32rem] overflow-y-auto">
        {logs.length === 0 ? (
          <div className="text-gray-500">No logs yet…</div>
        ) : (
          logs.map((line, i) => (
            <div
              key={i}
              className="text-gray-300 leading-5 whitespace-pre-wrap break-all"
            >
              {line}
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}