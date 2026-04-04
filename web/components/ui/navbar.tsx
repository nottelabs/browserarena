import * as React from "react";
import { cn } from "@/lib/utils";

function NavBar({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      data-slot="navbar"
      className={cn(
        "sticky top-0 z-50 border-b border-border/50 bg-background",
        className
      )}
      {...props}
    />
  );
}

function NavBarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="navbar-content"
      className={cn(
        "relative mx-auto flex h-14 max-w-6xl items-center justify-between px-6 sm:px-10",
        className
      )}
      {...props}
    >
      <span
        aria-hidden
        className="accent-line pointer-events-none absolute inset-x-10 bottom-0 h-px rounded-full bg-gradient-to-r from-transparent via-primary/70 to-transparent"
      />
      {props.children}
    </div>
  );
}

function NavBarBrand({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="navbar-brand"
      className={cn("flex items-center", className)}
      {...props}
    />
  );
}

function NavBarActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="navbar-actions"
      className={cn("flex items-center gap-4", className)}
      {...props}
    />
  );
}

export { NavBar, NavBarContent, NavBarBrand, NavBarActions };
