"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  FlaskConical,
  ShieldCheck,
  Bug,
  TestTube2,
  Server,
  LineChart,
  Coins,
  Package,
  PackageCheck,
  Zap,
  ScrollText,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getToken } from "@/lib/auth";
import api from "@/lib/api";

const STUCK_HREF = "/stuck-bookings";
const STUCK_POLL_MS = 60_000;

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/users", label: "Users", icon: Users },
  { href: "/bookings", label: "Bookings", icon: CalendarCheck },
  { href: STUCK_HREF, label: "Stuck Bookings", icon: AlertTriangle },
  { href: "/results", label: "Results", icon: FlaskConical },
  { href: "/packages", label: "Packages", icon: PackageCheck },
  { href: "/credits/balances", label: "Credit Balances", icon: Coins },
  { href: "/credits/packs", label: "Credit Packs", icon: Package },
  { href: "/credits/action-costs", label: "Action Costs", icon: Zap },
  { href: "/audit-log", label: "Audit Log", icon: ScrollText },
  { href: "/admins", label: "Admin Users", icon: ShieldCheck },
  { href: "/infra", label: "Infra", icon: Server },
  { href: "/usage", label: "Usage", icon: LineChart },
  { href: "/debug", label: "Debug", icon: Bug },
  { href: "/thyrocare", label: "Thyrocare", icon: TestTube2 },
];

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();
  const [stuckCount, setStuckCount] = useState(0);

  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    const poll = () => {
      if (document.hidden) return;
      api
        .get<{ count: number }>("/bookings/stuck")
        .then((r) => { if (!cancelled) setStuckCount(r.data.count ?? 0); })
        .catch(() => { /* badge is best-effort; ignore transient failures */ });
    };
    poll();
    const id = setInterval(poll, STUCK_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <aside className={cn("flex flex-col w-60 bg-card border-r border-border min-h-screen py-6", className)}>
      <div className="px-6 mb-8">
        <span className="text-xl font-bold tracking-tight text-primary">Jiive Admin</span>
      </div>
      <nav className="flex flex-col gap-1 px-3">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon size={16} />
              <span className="flex-1">{label}</span>
              {href === STUCK_HREF && stuckCount > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1.5 text-xs font-semibold text-white">
                  {stuckCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
