"use client";

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
} from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/users", label: "Users", icon: Users },
  { href: "/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/results", label: "Results", icon: FlaskConical },
  { href: "/admins", label: "Admin Users", icon: ShieldCheck },
  { href: "/debug", label: "Debug", icon: Bug },
  { href: "/thyrocare", label: "Thyrocare", icon: TestTube2 },
];

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();
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
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
