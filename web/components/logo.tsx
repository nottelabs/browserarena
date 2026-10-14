import styles from "./logo.module.css";

export function Logo({
  size = "md",
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const taglineSize = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-xl sm:text-lg",
  };

  return (
    <span
      className={`inline-flex items-center gap-2 leading-none select-none ${taglineSize[size]} ${className}`}
      style={{ fontFamily: "var(--font-dm-sans), sans-serif" }}
    >
      <span className={`${styles.mark} ${styles[size]}`}>Browserarena<span className="hidden md:inline">.</span></span>
      <span className="hidden whitespace-nowrap md:inline text-muted-foreground font-normal">Trusted open-source browser benchmarks.</span>
    </span>
  );
}
