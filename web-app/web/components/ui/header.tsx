import * as React from "react";
import { cn } from "@/lib/utils";

function Header({ className, ...props }: React.ComponentProps<"header">) {
  return (
    <header
      data-slot="header"
      className={cn("relative", className)}
      {...props}
    />
  );
}

function HeaderContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="header-content"
      className={cn(
        "relative mx-auto max-w-6xl px-6 pt-12 pb-8 sm:px-10",
        className
      )}
      {...props}
    >
      <div className="relative">{props.children}</div>
    </div>
  );
}

function HeaderTitle({ className, ...props }: React.ComponentProps<"h1">) {
  return (
    <h1
      data-slot="header-title"
      className={cn(
        "text-3xl font-bold tracking-[-0.03em] text-foreground sm:text-4xl",
        className
      )}
      {...props}
    />
  );
}

function HeaderDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="header-description"
      className={cn(
        "mt-2 text-sm text-muted-foreground max-w-md",
        className
      )}
      {...props}
    />
  );
}

function HeaderActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="header-actions"
      className={cn("mt-8", className)}
      {...props}
    />
  );
}

export {
  Header,
  HeaderContent,
  HeaderTitle,
  HeaderDescription,
  HeaderActions,
};
