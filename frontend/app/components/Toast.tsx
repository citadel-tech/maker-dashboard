import { useEffect, useEffectEvent, useState } from "react";

interface ToastProps {
  message: string;
  durationMs?: number;
  onDismiss: () => void;
}

export function Toast({ message, durationMs = 5000, onDismiss }: ToastProps) {
  const [visible, setVisible] = useState(true);
  const onDismissEvent = useEffectEvent(() => onDismiss());

  useEffect(() => {
    const hide = setTimeout(() => setVisible(false), durationMs - 400);
    const dismiss = setTimeout(onDismissEvent, durationMs);
    return () => {
      clearTimeout(hide);
      clearTimeout(dismiss);
    };
  }, [durationMs]);

  if (!visible) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-slide-in-right">
      <div className="flex items-center gap-3 rounded-lg border border-green-700 bg-gray-950 px-4 py-3 text-sm text-green-400 shadow-lg">
        <span className="text-green-500">✓</span>
        {message}
      </div>
    </div>
  );
}
