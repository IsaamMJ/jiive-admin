"use client";

import { Trash2, MessageSquarePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "./types";

interface Props {
  conversations: ConversationSummary[];
  activeId: string | null;
  streaming: boolean;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ConversationSidebar({ conversations, activeId, streaming, onNew, onOpen, onDelete }: Props) {
  return (
    <div className="flex flex-col w-60 shrink-0 rounded-lg border border-border bg-card min-h-0 overflow-hidden">
      {/* New chat button */}
      <div className="p-2 border-b border-border">
        <button
          type="button"
          disabled={streaming}
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <MessageSquarePlus size={14} />
          New chat
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto py-1">
        {conversations.length === 0 && (
          <p className="px-3 py-4 text-xs text-muted-foreground text-center">No conversations yet</p>
        )}
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={cn(
              "group flex items-center gap-1 px-2 py-1.5 cursor-pointer rounded-md mx-1 transition-colors",
              activeId === conv.id
                ? "bg-primary/10 text-primary"
                : "hover:bg-accent hover:text-accent-foreground text-foreground",
            )}
            onClick={() => { if (!streaming) onOpen(conv.id); }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onOpen(conv.id); }}
            aria-label={`Open conversation: ${conv.title}`}
          >
            <div className="flex-1 min-w-0">
              <p className="truncate text-xs font-medium leading-tight">{conv.title}</p>
              <p className="text-[10px] text-muted-foreground">{formatDate(conv.updatedAt)}</p>
            </div>
            <button
              type="button"
              aria-label={`Delete conversation: ${conv.title}`}
              onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
              className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
