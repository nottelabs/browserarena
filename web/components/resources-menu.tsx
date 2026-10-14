"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const RESOURCES = [
  { label: "FAQ", href: "/faq" },
  { label: "Methodology", href: "https://github.com/nottelabs/browserarena", external: true },
  {
    label: "Reproduce",
    href: "https://railway.com/deploy/UNedGj?referralCode=YUwE3Q&utm_medium=integration&utm_source=template&utm_campaign=generic",
    external: true,
  },
  { label: "Contribute", href: "https://github.com/nottelabs/browserarena/blob/main/CONTRIBUTING.md", external: true },
  { label: "Add a Provider", href: "https://github.com/nottelabs/browserarena", external: true },
  { label: "Add a Bench", href: "https://github.com/nottelabs/browserarena", external: true },
  {
    label: "Slack",
    href: "https://go.notte.cc/slack",
    external: true,
  },
] as const;

export function ResourcesMenu() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group inline-flex h-9 items-center gap-1.5 rounded-[3px] border-[1.5px] border-foreground bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-foreground hover:text-background data-[state=open]:bg-foreground data-[state=open]:text-background"
        >
          Resources
          <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 rounded-[3px] border-[1.5px] border-foreground bg-background p-1 shadow-none">
        <ul>
          {RESOURCES.map((item) => (
            <li key={item.label}>
              <PopoverClose asChild>
                {"external" in item ? (
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-[2px] px-3 py-2 text-sm text-foreground hover:bg-foreground hover:text-background"
                  >
                    {item.label}
                  </a>
                ) : (
                  <Link
                    href={item.href}
                    className="block rounded-[2px] px-3 py-2 text-sm text-foreground hover:bg-foreground hover:text-background"
                  >
                    {item.label}
                  </Link>
                )}
              </PopoverClose>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
