import Link from "next/link";
import { Logo } from "@/components/logo";

export default function NotFound() {
  return (
    <div className="page-ambient min-h-screen flex flex-col items-center justify-center px-6">
      <div className="text-center">
        <p className="font-mono text-[0.7rem] text-muted-foreground mb-4">404</p>
        <h1 className="text-2xl font-semibold text-foreground mb-2">Page not found</h1>
        <p className="text-sm text-muted-foreground mb-8">
          The page you&apos;re looking for doesn&apos;t exist.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Back to leaderboard
        </Link>
      </div>
      <div className="mt-12 opacity-40">
        <Logo size="sm" />
      </div>
    </div>
  );
}
