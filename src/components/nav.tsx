"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { BarChart3, Building2, GitCompare, History, Link2, ListChecks, Play, Settings, Swords, Ruler } from "lucide-react";

const items = [
  { href: "/dashboard", label: "Overview", icon: BarChart3 },
  { href: "/brands", label: "Brands", icon: Building2 },
  { href: "/queries", label: "Tracking queries", icon: ListChecks },
  { href: "/runs", label: "Run tracker", icon: Play },
  { href: "/citations", label: "Citation explorer", icon: Link2 },
  { href: "/competitors", label: "Competitors", icon: Swords },
  { href: "/history", label: "Snapshot history", icon: History },
  { href: "/compare", label: "Compare snapshots", icon: GitCompare },
  { href: "/metrics", label: "Metric definitions", icon: Ruler },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:px-3 lg:pb-0" aria-label="Main">
      {items.map(({ href, label, icon: Icon }) => {
        const active = path === href || path.startsWith(href + "/") || (href === "/runs" && path.startsWith("/snapshots"));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm",
              active ? "bg-ink text-white" : "text-slate hover:bg-sunken hover:text-ink",
            )}
          >
            <Icon size={16} strokeWidth={1.75} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
