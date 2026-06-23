"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Send, Square, ChevronDown, ChevronUp, Copy, RotateCcw, ArrowDown, Settings2, X, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TranscriptEntry, LlmModel, AwsState } from "./types";

// Maximum prompt length accepted by the backend contract.
const MAX_PROMPT_CHARS = 8000;
// Show the char counter within this many chars of the limit.
const COUNTER_WARN_THRESHOLD = 500;
// Maximum system prompt length accepted by the backend contract (8000 per backend, 2026-06-23).
const MAX_SYSTEM_PROMPT_CHARS = 8000;
// Show the system prompt char counter within this many chars of the limit.
const SYSTEM_PROMPT_COUNTER_WARN_THRESHOLD = 500;
// Auto-scroll threshold — if the user is within this many px of the bottom, keep following.
const SCROLL_BOTTOM_THRESHOLD = 80;

interface Props {
  transcript: TranscriptEntry[];
  streamingText: string; // accumulating text for the in-flight answer
  streaming: boolean;
  model: LlmModel;
  useRag: boolean;
  awsState: AwsState;
  systemPrompt: string;
  onSend: (prompt: string) => void;
  onStop: () => void;
  onStartBox: () => void; // called when user hits "Start box" inside an aws_offline error
  onToggleRag: () => void;
  onRegenerate: () => void;
  onSystemPromptChange: (value: string) => void;
  onNewChat: () => void;
}

// ── Shared markdown styles ────────────────────────────────────────────────────

const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  // Headings — sensible size hierarchy inside a chat bubble
  h1: ({ children }) => (
    <h1 className="text-base font-semibold mt-3 mb-1 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-sm font-semibold mt-2.5 mb-1 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-medium mt-2 mb-0.5 first:mt-0">{children}</h3>
  ),
  // Paragraphs — let them breathe a little
  p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{children}</p>,
  // Ordered and unordered lists
  ul: ({ children }) => <ul className="my-1 ml-4 list-disc space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 ml-4 list-decimal space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  // Inline code
  code: ({ className, children, ...rest }) => {
    // Block code (inside <pre>) vs inline code
    const isInline = !className;
    if (isInline) {
      return (
        <code
          className="rounded bg-muted-foreground/15 px-1 py-0.5 font-mono text-[0.82em]"
          {...rest}
        >
          {children}
        </code>
      );
    }
    return (
      <code className="font-mono text-[0.82em]" {...rest}>
        {children}
      </code>
    );
  },
  // Code blocks — muted background, horizontal scroll, no syntax highlighter
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md border border-border bg-muted/60 px-3 py-2 text-xs leading-relaxed">
      {children}
    </pre>
  ),
  // Tables with borders
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-border px-2 py-1 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1">{children}</td>
  ),
  // Blockquote
  blockquote: ({ children }) => (
    <blockquote className="my-1 border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground">
      {children}
    </blockquote>
  ),
  // Horizontal rule
  hr: () => <hr className="my-2 border-border" />,
  // Strong / em
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
};

// Renders markdown for assistant messages (both streaming and committed).
function AssistantMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
      {text}
    </ReactMarkdown>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RagSourcesBlock({ sources }: { sources: NonNullable<TranscriptEntry["ragSources"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
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

interface BubbleProps {
  entry: TranscriptEntry;
  isLast: boolean;
  isLastEntry: boolean;
  streaming: boolean;
  onRegenerate: () => void;
}

function Bubble({ entry, isLast, isLastEntry, streaming, onRegenerate }: BubbleProps) {
  const isUser = entry.role === "user";
  const isError = !!entry.error;
  const isStopped = !!entry.stopped;

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(entry.text);
      toast.success("Copied");
    } catch {
      // Fallback for denied permission / non-secure contexts.
      try {
        const ta = document.createElement("textarea");
        ta.value = entry.text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        toast.success("Copied");
      } catch {
        toast.error("Copy failed — select and copy manually");
      }
    }
  };

  return (
    <div className={cn("group flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
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
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{entry.text}</p>
        ) : (
          <div className="break-words prose-sm prose-neutral dark:prose-invert max-w-none">
            <AssistantMarkdown text={entry.text} />
          </div>
        )}
        {!isUser && entry.model && !isError && (
          <span className="mt-1 block text-[10px] text-muted-foreground uppercase tracking-wide">
            {entry.model === "aws" ? "AWS MedGemma" : "HuggingFace"}
            {isStopped && (
              <span className="ml-1.5 normal-case text-muted-foreground/70">⏹ stopped</span>
            )}
          </span>
        )}
      </div>

      {/* Copy + Regenerate actions — shown on hover (and always for the last message) */}
      {!isUser && !isError && (
        <div
          className={cn(
            "flex items-center gap-1 px-1 transition-opacity",
            isLast ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <button
            type="button"
            aria-label="Copy answer"
            onClick={copyText}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <Copy size={11} />
            Copy
          </button>
          {isLast && (
            <button
              type="button"
              aria-label="Regenerate answer"
              disabled={streaming}
              onClick={onRegenerate}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RotateCcw size={11} />
              Regenerate
            </button>
          )}
        </div>
      )}

      {/* Retry on the most recent error (e.g. HF cold-start 503) — re-sends the last prompt. */}
      {!isUser && isError && isLastEntry && (
        <div className="flex items-center gap-1 px-1">
          <button
            type="button"
            aria-label="Retry"
            disabled={streaming}
            onClick={onRegenerate}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RotateCcw size={11} />
            Retry
          </button>
        </div>
      )}

      {!isUser && entry.ragSources && entry.ragSources.length > 0 && (
        <div className="max-w-[85%] px-1">
          <RagSourcesBlock sources={entry.ragSources} />
        </div>
      )}
      {!isUser && entry.latencyMs !== undefined && !isError && (
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
        <div className="break-words prose-sm prose-neutral dark:prose-invert max-w-none">
          <AssistantMarkdown text={text} />
        </div>
        {/* Blinking cursor appended after the markdown */}
        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground/60" />
        <span className="mt-1 block text-[10px] text-muted-foreground uppercase tracking-wide">
          {model === "aws" ? "AWS MedGemma" : "HuggingFace"}
        </span>
      </div>
    </div>
  );
}

// Contextual banner shown when AWS is selected but the box isn't ready to serve.
function BoxBanner({
  awsState, streaming, onStartBox,
}: { awsState: AwsState; streaming: boolean; onStartBox: () => void }) {
  let text: string;
  let dot = "bg-yellow-500";
  let action: React.ReactNode = null;

  switch (awsState) {
    case "stopped":
      text = "MedGemma box is offline — start it to use AWS MedGemma (~2-3 min).";
      dot = "bg-red-500";
      action = (
        <Button size="sm" variant="outline" disabled={streaming} onClick={onStartBox}>
          Start box
        </Button>
      );
      break;
    case "pending":
      text = "MedGemma box is starting… this takes ~2-3 min.";
      break;
    case "stopping":
      text = "MedGemma box is stopping…";
      break;
    case "permission_denied":
      text = "MedGemma box control needs IAM access — contact ops.";
      dot = "bg-muted-foreground";
      break;
    case "error":
    default:
      text = "MedGemma box status is unavailable — you can still try sending; it may still respond.";
      dot = "bg-muted-foreground";
      break;
  }

  return (
    <div className="mx-4 mb-2 flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-4 py-2.5">
      <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", dot)} />
      <p className="flex-1 text-sm text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}

// ── Main ChatPanel ────────────────────────────────────────────────────────────

export function ChatPanel({
  transcript,
  streamingText,
  streaming,
  model,
  useRag,
  awsState,
  systemPrompt,
  onSend,
  onStop,
  onStartBox,
  onToggleRag,
  onRegenerate,
  onSystemPromptChange,
  onNewChat,
}: Props) {
  const [prompt, setPrompt] = useState("");
  const [systemPromptOpen, setSystemPromptOpen] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Smart auto-scroll: track whether the user is near the bottom.
  const isNearBottomRef = useRef(true);
  const [showJumpButton, setShowJumpButton] = useState(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD;
    isNearBottomRef.current = nearBottom;
    setShowJumpButton(!nearBottom);
  }, []);

  // Auto-scroll on new tokens — only if the user is near the bottom (instant for perf).
  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom("auto");
    }
  }, [streamingText, scrollToBottom]);

  // Smooth scroll when a new transcript entry lands (send or done).
  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom("smooth");
    }
  }, [transcript.length, scrollToBottom]);

  const handleSend = () => {
    const trimmed = prompt.trim();
    if (!trimmed || streaming || trimmed.length > MAX_PROMPT_CHARS) return;
    if (systemPromptOverLimit) return;
    onSend(trimmed);
    setPrompt("");
    // Reset textarea height back to single row and refocus.
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.focus();
    }
    // The user sent, so re-enable auto-follow.
    isNearBottomRef.current = true;
    setShowJumpButton(false);
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

  const charCount = prompt.length;
  const overLimit = charCount > MAX_PROMPT_CHARS;
  const showCounter = charCount >= MAX_PROMPT_CHARS - COUNTER_WARN_THRESHOLD;

  const systemPromptCharCount = systemPrompt.length;
  const systemPromptOverLimit = systemPromptCharCount > MAX_SYSTEM_PROMPT_CHARS;
  const showSystemPromptCounter =
    systemPromptCharCount >= MAX_SYSTEM_PROMPT_CHARS - SYSTEM_PROMPT_COUNTER_WARN_THRESHOLD;
  // A prompt is "custom" if it has non-whitespace content.
  const hasCustomSystemPrompt = systemPrompt.trim().length > 0;

  const lastIdx = transcript.length - 1;

  return (
    <div className="flex flex-col flex-1 min-h-0 rounded-lg border border-border bg-card">
      {/* Transcript */}
      <div
        ref={scrollAreaRef}
        onScroll={handleScroll}
        className="relative flex-1 overflow-y-auto p-4 flex flex-col gap-3"
      >
        {transcript.length === 0 && !streaming && (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground py-16 text-center">
            <span>Ask a medical question — follow-ups keep context in this chat.</span>
          </div>
        )}
        {transcript.map((entry, idx) => (
          <Bubble
            key={entry.id}
            entry={entry}
            isLast={idx === lastIdx && entry.role === "assistant" && !entry.error}
            isLastEntry={idx === lastIdx}
            streaming={streaming}
            onRegenerate={onRegenerate}
          />
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

        {/* Jump-to-latest button — shown when user has scrolled up */}
        {showJumpButton && (
          <button
            type="button"
            aria-label="Jump to latest message"
            onClick={() => {
              isNearBottomRef.current = true;
              setShowJumpButton(false);
              scrollToBottom("smooth");
            }}
            className="sticky bottom-2 self-center flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-md hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <ArrowDown size={12} />
            Jump to latest
          </button>
        )}
      </div>

      {/* Proactive MedGemma box guidance — shown whenever AWS is selected but the box isn't ready,
          so the operator knows the state before sending instead of after a failed request. */}
      {model === "aws" && awsState !== "running" && awsState !== "unconfigured" && (
        <BoxBanner awsState={awsState} streaming={streaming} onStartBox={onStartBox} />
      )}

      {/* Composer */}
      <div className="border-t border-border p-3 flex flex-col gap-2">
        {/* RAG toggle + system prompt disclosure + new chat + model note */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={useRag}
            aria-label={`RAG grounding ${useRag ? "on" : "off"}`}
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

          {/* New chat — clears the transcript; disabled mid-stream */}
          <button
            type="button"
            aria-label="New chat"
            disabled={streaming}
            onClick={onNewChat}
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <MessageSquarePlus size={11} />
            New chat
          </button>

          {/* System prompt disclosure */}
          <button
            type="button"
            aria-expanded={systemPromptOpen}
            aria-label="Toggle system prompt"
            onClick={() => setSystemPromptOpen((v) => !v)}
            className={cn(
              "flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
              systemPromptOpen
                ? "border-primary bg-primary/10 text-primary"
                : hasCustomSystemPrompt
                  ? "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-600"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Settings2 size={11} />
            System prompt
            {hasCustomSystemPrompt && !systemPromptOpen && (
              <span className="ml-0.5 rounded-full bg-amber-400/30 px-1 py-0 text-[10px] font-medium">
                custom
              </span>
            )}
            {systemPromptOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>

          <span className="text-xs text-muted-foreground">Shift+Enter for newline</span>
          {/* Character counter — only shown near or over the limit */}
          {showCounter && (
            <span
              className={cn(
                "ml-auto text-xs tabular-nums",
                overLimit ? "text-destructive font-medium" : "text-muted-foreground",
              )}
            >
              {charCount}/{MAX_PROMPT_CHARS}
            </span>
          )}
        </div>

        {/* System prompt editor — collapsible */}
        {systemPromptOpen && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                System prompt override
              </span>
              <div className="flex items-center gap-2">
                {showSystemPromptCounter && (
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      systemPromptOverLimit
                        ? "text-destructive font-medium"
                        : "text-muted-foreground",
                    )}
                  >
                    {systemPromptCharCount}/{MAX_SYSTEM_PROMPT_CHARS}
                  </span>
                )}
                {hasCustomSystemPrompt && (
                  <button
                    type="button"
                    aria-label="Reset system prompt to default"
                    onClick={() => onSystemPromptChange("")}
                    className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    <X size={11} />
                    Reset
                  </button>
                )}
              </div>
            </div>
            <textarea
              value={systemPrompt}
              onChange={(e) => {
                // Block input past the 2000-char contract limit.
                if (e.target.value.length <= MAX_SYSTEM_PROMPT_CHARS) {
                  onSystemPromptChange(e.target.value);
                }
              }}
              disabled={streaming}
              placeholder="e.g. You are a clinical assistant for doctors; provide reference ranges with sources."
              rows={3}
              aria-label="System prompt override"
              className={cn(
                "w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm",
                "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                systemPromptOverLimit && "border-destructive focus:ring-destructive",
              )}
              style={{ minHeight: "72px", maxHeight: "160px" }}
            />
            <p className="text-[11px] text-muted-foreground">
              Empty means use the backend default. Applies to both models and to Regenerate.
            </p>
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={streaming}
            placeholder="Ask a medical question…"
            rows={1}
            aria-label="Prompt input"
            className={cn(
              "flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm",
              "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              overLimit && "border-destructive focus:ring-destructive",
            )}
            style={{ minHeight: "40px", maxHeight: "160px" }}
          />
          {streaming ? (
            <Button
              size="sm"
              variant="outline"
              aria-label="Stop generation"
              onClick={onStop}
              className="shrink-0"
            >
              <Square size={13} />
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleSend}
              disabled={!prompt.trim() || overLimit || systemPromptOverLimit}
              title={
                overLimit
                  ? `Prompt exceeds ${MAX_PROMPT_CHARS} character limit`
                  : systemPromptOverLimit
                    ? `System prompt exceeds ${MAX_SYSTEM_PROMPT_CHARS} character limit`
                    : undefined
              }
              aria-label="Send message"
              aria-disabled={!prompt.trim() || overLimit || systemPromptOverLimit}
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
