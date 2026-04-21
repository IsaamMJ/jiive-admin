"use client";

import { useTheme } from "next-themes";
import { Moon, Sun, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export function TopBar({ title }: { title: string }) {
  const { theme, setTheme } = useTheme();
  const { name, logout } = useAuth();

  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="flex items-center gap-3">
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
