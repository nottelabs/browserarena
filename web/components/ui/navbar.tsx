import * as React from "react";
import { cn } from "@/lib/utils";

function NavBar({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      data-slot="navbar"
      className={cn(
        "sticky top-0 z-50 border-b-[1.5px] border-foreground bg-[color-mix(in_oklch,var(--primary)_6%,var(--background))]",
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
        "relative flex h-16 items-center justify-between px-4 sm:px-10",
        className
      )}
      {...props}
    >
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
