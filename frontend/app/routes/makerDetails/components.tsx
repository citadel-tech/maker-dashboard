export function LoadingCard() {
  return (
    <div className="cs-card p-6 animate-pulse">
      <div className="mb-3 h-4 w-1/3 rounded bg-[var(--cs-surface-3)]" />
      <div className="h-7 w-1/2 rounded bg-[var(--cs-surface-3)]" />
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return <div className="cs-banner warn text-sm">{message}</div>;
}
