"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Grid3x3,
  LayoutDashboard,
  PiggyBank,
  Plug,
  Receipt,
  Settings,
  Table2,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/positions", label: "Positions", icon: Table2 },
  { href: "/heatmap", label: "Heat Map", icon: Grid3x3 },
  { href: "/cash", label: "Cash", icon: Wallet },
  { href: "/income", label: "Income", icon: PiggyBank },
  { href: "/trades", label: "Trades & P/L", icon: Receipt },
  { href: "/accounts", label: "Accounts", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 p-3">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
