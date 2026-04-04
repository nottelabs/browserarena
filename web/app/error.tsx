"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="page-ambient min-h-screen flex flex-col items-center justify-center px-6">
      <div className="text-center">
        <p className="font-mono text-[0.7rem] text-muted-foreground mb-4">500</p>
        <h1 className="text-2xl font-semibold text-foreground mb-2">Something went wrong</h1>
        <p className="text-sm text-muted-foreground mb-8">
          An error occurred while loading the leaderboard.
        </p>
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
