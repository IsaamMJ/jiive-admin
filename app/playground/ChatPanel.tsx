"use client";

import { useRef, useEffect, useState } from "react";
import { Send, Square, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TranscriptEntry, LlmModel, AwsState } from "./types";

interface Props {
  transcript: TranscriptEntry[];
  streamingText: string; // accumulating text for the in-flight answer
  streaming: boolean;
  model: LlmModel;
  useRag: boolean;
  awsState: AwsState;
  onSend: (prompt: string) => void;
  onStop: () => void;
  onStartBox: () => void; // called when user hits "Start box" inside an aws_offline error
  onToggleRag: () => void;
}

function RagSourcesBlock({ sources }: { sources: NonNullable<TranscriptEntry["ragSources"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        Grounded on {sources.length} source{sources.length !== 1 ? "s" : ""}
      </button>
      {open && (
        <ul className="mt-2 flex flex-col gap-2 pl-2 border-l border-border">
          {sources.map((s, i) => (
            <li key={i} className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-foreground">{s.title}</span>
              <span className="text-xs text-muted-foreground line-clamp-2">{s.snippet}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Bubble({ entry }: { entry: TranscriptEntry }) {
  const isUser = entry.role === "user";
  const isError = !!entry.error;

  return (
    <div className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : isError
              ? "bg-destructive/10 text-destructive border border-destructive/20 rounded-bl-sm"
              : "bg-muted text-foreground rounded-bl-sm",
        )}
      >
        <p className="whitespace-pre-wrap break-words">{entry.text}</p>
        {!isUser && entry.model && !isError && (
          <span className="mt-1 block text-[10px] text-muted-foreground uppercase tracking-wide">
            {entry.model === "aws" ? "AWS MedGemma" : "HuggingFace"}
          </span>
        )}
      </div>
      {!isUser && entry.ragSources && entry.ragSources.length > 0 && (
        <div className="max-w-[85%] px-1">
          <RagSourcesBlock sources={entry.ragSources} />
        </div>
      )}
      {!isUser && (entry.latencyMs !== undefined) && !isError && (
        <span className="px-1 text-[10px] text-muted-foreground tabular-nums">
          {entry.latencyMs}ms
          {entry.completionTokens !== undefined && ` · ${entry.completionTokens} tokens`}
        </span>
      )}
    </div>
  );
}

function StreamingBubble({ text, model }: { text: string; model: LlmModel }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-4 py-2.5 text-sm text-foreground">
        <p className="whitespace-pre-wrap break-words">
          {text}
          <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground/60" />
        </p>
        <span className="mt-1 block text-[10px] text-muted-foreground uppercase tracking-wide">
          {model === "aws" ? "AWS MedGemma" : "HuggingFace"}
        </span>
      </div>
    </div>
  );
}

export function ChatPanel({
  transcript,
  streamingText,
  streaming,
  model,
  useRag,
  awsState,
  onSend,
  onStop,
  onStartBox,
  onToggleRag,
}: Props) {
  const [prompt, setPrompt] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom when transcript or streaming text changes.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, streamingText]);

  const handleSend = () => {
    const trimmed = prompt.trim();
    if (!trimmed || streaming) return;
    onSend(trimmed);
    setPrompt("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-resize textarea.
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 rounded-lg border border-border bg-card">
      {/* Transcript */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {transcript.length === 0 && !streaming && (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground py-16 text-center">
            <span>Ask a medical question — each message is independent (stateless).</span>
          </div>
        )}
        {transcript.map((entry) => (
          <Bubble key={entry.id} entry={entry} />
        ))}
        {streaming && streamingText !== "" && (
          <StreamingBubble text={streamingText} model={model} />
        )}
        {streaming && streamingText === "" && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
            <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
            <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* aws_offline inline prompt */}
      {!streaming && model === "aws" && awsState === "stopped" && transcript.length > 0 && (
        (() => {
          const last = transcript[transcript.length - 1];
          return last?.error === "aws_offline" ? (
            <div className="mx-4 mb-2 flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-4 py-2.5">
              <p className="flex-1 text-sm text-muted-foreground">
                MedGemma box is offline. Start it to continue.
              </p>
              <Button size="sm" variant="outline" onClick={onStartBox}>
                Start box
              </Button>
            </div>
          ) : null;
        })()
      )}

      {/* Composer */}
      <div className="border-t border-border p-3 flex flex-col gap-2">
        {/* RAG toggle + model note */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleRag}
            disabled={streaming}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40",
              useRag
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            RAG {useRag ? "on" : "off"}
          </button>
          <span className="text-xs text-muted-foreground">Shift+Enter for newline</span>
        </div>

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={streaming}
            placeholder="Ask a medical question…"
            rows={1}
            className={cn(
              "flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm",
              "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
            style={{ minHeight: "40px", maxHeight: "160px" }}
          />
          {streaming ? (
            <Button size="sm" variant="outline" onClick={onStop} className="shrink-0">
              <Square size={13} />
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleSend}
              disabled={!prompt.trim()}
              className="shrink-0"
            >
              <Send size={13} />
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
