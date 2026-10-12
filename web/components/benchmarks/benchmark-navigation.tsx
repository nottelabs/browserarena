"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, useTransition, type ComponentProps, type ReactNode } from "react";

type Navigation = { pending: boolean; navigate: (href: string) => void };
const NavigationContext = createContext<Navigation | null>(null);

export function BenchmarkNavigationProvider({ children, className }: { children: ReactNode; className: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showProgress, setShowProgress] = useState(false);

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setShowProgress(true), 150);
    return () => { clearTimeout(timer); setShowProgress(false); };
  }, [pending]);

  const navigate = (href: string) => startTransition(() => router.push(href, { scroll: false }));
  return <NavigationContext.Provider value={{ pending, navigate }}>
    <div className={className} aria-busy={pending}>
      {showProgress && <div data-benchmark-progress role="status" aria-label="Updating benchmark results"><span /></div>}
      {children}
    </div>
  </NavigationContext.Provider>;
}

// The original test page keeps its local transitions when no dashboard provider is present.
export function useBenchmarkNavigation() {
  const shared = useContext(NavigationContext);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return shared ?? { pending, navigate: (href: string) => startTransition(() => router.push(href, { scroll: false })) };
}

export function BenchmarkLink({ onNavigate, ...props }: ComponentProps<typeof Link>) {
  const shared = useContext(NavigationContext);
  return <Link {...props} onNavigate={event => {
    onNavigate?.(event);
    if (shared && typeof props.href === "string") {
      event.preventDefault();
      shared.navigate(props.href);
    }
  }} />;
}
