"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  className?: string;
  /** When true, stops the click from bubbling to a parent button (e.g. row toggle). */
  stopPropagation?: boolean;
  /** Optional override for the displayed text (defaults to value). */
  label?: string;
}

export function CopyableId({ value, className, stopPropagation = true, label }: Props) {
  const [copied, setCopied] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    if (stopPropagation) {
      e.stopPropagation();
      e.preventDefault();
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard may be blocked (insecure context); silently ignore.
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={`Copy ${value}`}
      className={cn(
        "group inline-flex items-center gap-1.5 font-mono text-xs px-2 py-0.5 rounded-md border transition-all cursor-pointer tabular-nums",
        copied
          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
          : "bg-muted/70 text-foreground/80 border-border/40 hover:bg-muted hover:border-border",
        className
      )}
    >
      <span>{label ?? value}</span>
      {copied ? (
        <Check size={11} className="shrink-0" />
      ) : (
        <Copy size={11} className="shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
      )}
    </button>
  );
}
