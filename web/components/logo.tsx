export function Logo({
  size = "md",
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-2xl sm:text-lg",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium leading-none select-none ${sizes[size]} ${className}`}
      style={{ fontFamily: "var(--font-dm-sans), sans-serif" }}
    >
      <span className="font-semibold text-foreground">The Browser Arena<span className="hidden sm:inline">.</span></span>
      <span className="hidden sm:inline text-muted-foreground font-normal">Open-source benchmarks.</span>
    </span>
  );
}
