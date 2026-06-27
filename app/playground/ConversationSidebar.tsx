"use client";

import { useRef, useState } from "react";
import { Trash2, MessageSquarePlus, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "./types";

interface Props {
  conversations: ConversationSummary[];
  activeId: string | null;
  streaming: boolean;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
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

const MAX_TITLE_LEN = 200;

export function ConversationSidebar({ conversations, activeId, streaming, onNew, onOpen, onDelete, onRename }: Props) {
  // id of the row currently being renamed; null = none
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function startRename(conv: ConversationSummary) {
    setEditingId(conv.id);
    setEditValue(conv.title);
    // autofocus + select-all happens via autoFocus + onFocus on the input
  }

  function commitRename() {
    const trimmed = editValue.trim().slice(0, MAX_TITLE_LEN);
    if (trimmed && editingId) {
      onRename(editingId, trimmed);
    }
    setEditingId(null);
    setEditValue("");
  }

  function cancelRename() {
    setEditingId(null);
    setEditValue("");
  }

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
        {conversations.map((conv) => {
          const isEditing = editingId === conv.id;

          return (
            <div
              key={conv.id}
              className={cn(
                "group flex items-center gap-1 px-2 py-1.5 cursor-pointer rounded-md mx-1 transition-colors",
                activeId === conv.id
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-accent hover:text-accent-foreground text-foreground",
              )}
              onClick={() => { if (!streaming && !isEditing) onOpen(conv.id); }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (isEditing) return; // let the input handle keyboard events
                if (e.key === "Enter" || e.key === " ") onOpen(conv.id);
              }}
              aria-label={`Open conversation: ${conv.title}`}
            >
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <input
                    ref={inputRef}
                    autoFocus
                    value={editValue}
                    maxLength={MAX_TITLE_LEN}
                    className="w-full bg-transparent border-b border-primary text-xs font-medium leading-tight outline-none py-0.5"
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      e.stopPropagation(); // don't let Enter bubble to the row's onKeyDown
                      if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                      if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
                    }}
                    onClick={(e) => e.stopPropagation()} // don't trigger onOpen
                  />
                ) : (
                  <p className="truncate text-xs font-medium leading-tight">{conv.title}</p>
                )}
                <p className="text-[10px] text-muted-foreground">{formatDate(conv.updatedAt)}</p>
                {!conv.isOwner && conv.createdByName && (
                  <p className="text-[10px] text-muted-foreground truncate">by {conv.createdByName}</p>
                )}
              </div>
              {conv.isOwner && !isEditing && (
                <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    aria-label={`Rename conversation: ${conv.title}`}
                    disabled={streaming}
                    onClick={(e) => { e.stopPropagation(); startRename(conv); }}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:cursor-not-allowed"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete conversation: ${conv.title}`}
                    onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
