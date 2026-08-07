"use client";

import { useTheme } from "next-themes";
import { Moon, Sun, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

function getEnvironment() {
  const baseURL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
  if (baseURL.includes("jiive-dev.isaam.dev")) {
    return "DEVELOPMENT";
  }
  return "PRODUCTION";
}

export function TopBar({ title }: { title: string }) {
  const { theme, setTheme } = useTheme();
  const { name, logout } = useAuth();
  const env = getEnvironment();
  const isDev = env === "DEVELOPMENT";

  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="flex items-center gap-3">
        <span className={`text-xs font-semibold px-2 py-1 rounded ${isDev ? "bg-amber-500/20 text-amber-700 dark:text-amber-300" : "bg-green-500/20 text-green-700 dark:text-green-300"}`}>
          {env}
        </span>
        <span className="text-sm text-muted-foreground hidden sm:block">{name}</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
        <Button variant="ghost" size="icon" onClick={logout}>
          <LogOut size={16} />
        </Button>
      </div>
    </header>
  );
}
