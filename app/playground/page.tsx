"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/AdminLayout";
import { Skeleton } from "@/components/ui/skeleton";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { ModelSwitch } from "./ModelSwitch";
import { AwsBoxControl } from "./AwsBoxControl";
import { ChatPanel } from "./ChatPanel";
import { useChatStream } from "./useChatStream";
import type {
  LlmModel,
  PlaygroundStatus,
  TranscriptEntry,
  RagSource,
  AwsState,
} from "./types";
import { isTransitioning } from "./types";

// Poll every 10s during transitions / after a box action.
const POLL_MS = 10_000;
// Steady-state refresh so the status pill never goes stale (box may be started/stopped elsewhere).
const IDLE_POLL_MS = 30_000;
// Max polls after a box action (~3 min / 10s = 18).
const MAX_POST_ACTION_POLLS = 18;

let entryCounter = 0;
const nextId = () => String(++entryCounter);

export default function PlaygroundPage() {
  const [model, setModel] = useState<LlmModel>("hf");
  const [useRag, setUseRag] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [streamingText, setStreamingText] = useState("");

  const [status, setStatus] = useState<PlaygroundStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  // Polling bookkeeping — kept in refs so the poll loop doesn't need to re-close over state.
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postActionPollsRef = useRef(0);
  const latestStateRef = useRef<AwsState | undefined>(undefined);

  const { streaming, send, stop } = useChatStream();

  // ── Status fetch (not called inside an effect body directly) ─────────────

  const fetchStatus = useCallback(() => {
    return api
      .get<PlaygroundStatus>("/llm-playground/status")
      .then((r) => {
        setStatus(r.data);
        setStatusLoading(false);
        latestStateRef.current = r.data.aws.state;
        return r.data;
      })
      .catch(() => {
        setStatusLoading(false);
        return null;
      });
  }, []);

  // ── Polling loop ─────────────────────────────────────────────────────────

  // Stored in a ref (set once in an effect) so it can safely reference itself
  // without triggering react-hooks/immutability from a useCallback self-call.
  const schedulePollRef = useRef<() => void>(() => { /* set in useEffect */ });
  const fetchStatusRef = useRef(fetchStatus);

  useEffect(() => {
    fetchStatusRef.current = fetchStatus;
  }, [fetchStatus]);

  // Wire up the scheduling function inside an effect — never during render.
  useEffect(() => {
    schedulePollRef.current = () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);

      const state = latestStateRef.current;
      const active = isTransitioning(state ?? "stopped") || postActionPollsRef.current > 0;
      // Fast cadence while transitioning / just after an action; slow idle refresh otherwise.
      // Always reschedule so the pill stays live (the box can be started/stopped elsewhere).
      const delay = active ? POLL_MS : IDLE_POLL_MS;

      pollTimerRef.current = setTimeout(() => {
        if (document.hidden) {
          // Page hidden — re-arm without burning the poll budget or hitting the API.
          schedulePollRef.current();
          return;
        }
        if (postActionPollsRef.current > 0) postActionPollsRef.current--;
        fetchStatusRef.current().then(() => { schedulePollRef.current(); });
      }, delay);
    };
  }, []);

  const schedulePoll = useCallback(() => { schedulePollRef.current(); }, []);

  // Mount: fetch once, then start polling if the box is transitioning.
  useEffect(() => {
    fetchStatus().then((data) => {
      if (data && isTransitioning(data.aws.state)) {
        postActionPollsRef.current = MAX_POST_ACTION_POLLS;
      }
      schedulePoll();
    });
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Called by AwsBoxControl after a successful box action.
  const handleBoxAction = useCallback(() => {
    postActionPollsRef.current = MAX_POST_ACTION_POLLS;
    fetchStatus().then(() => { schedulePoll(); });
  }, [fetchStatus, schedulePoll]);

  // ── Chat ─────────────────────────────────────────────────────────────────

  // Stores the meta payload from the current stream so onDone can access ragSources.
  const lastMetaRef = useRef<{ ragSources?: RagSource[] | null } | null>(null);

  // The last user prompt, for Regenerate.
  const lastPromptRef = useRef<string>("");

  const handleSend = (prompt: string) => {
    const userEntry: TranscriptEntry = { id: nextId(), role: "user", text: prompt };
    setTranscript((prev) => [...prev, userEntry]);
    setStreamingText("");
    lastPromptRef.current = prompt;

    let accumText = "";
    const assistantId = nextId();
    lastMetaRef.current = null;

    send(
      { prompt, model, useRag, systemPrompt: systemPrompt.trim() || undefined },
      {
        onMeta(meta) {
          lastMetaRef.current = { ragSources: meta.ragSources };
          accumText = "";
          setStreamingText("");
        },
        onToken(delta) {
          accumText += delta;
          setStreamingText(accumText);
        },
        onDone(done) {
          setStreamingText("");
          setTranscript((prev) => [
            ...prev,
            {
              id: assistantId,
              role: "assistant",
              text: accumText,
              model,
              ragSources: lastMetaRef.current?.ragSources ?? null,
              latencyMs: done.latencyMs,
              promptTokens: done.promptTokens,
              completionTokens: done.completionTokens,
            },
          ]);
          lastMetaRef.current = null;
        },
        onAbort(partialText, partialMeta) {
          // Commit whatever streamed so far as a stopped message.
          setStreamingText("");
          setTranscript((prev) => [
            ...prev,
            {
              id: assistantId,
              role: "assistant",
              text: partialText,
              model,
              ragSources: partialMeta?.ragSources ?? lastMetaRef.current?.ragSources ?? null,
              stopped: true,
            },
          ]);
          lastMetaRef.current = null;
        },
        onError(err) {
          setStreamingText("");
          const msg = err.message ?? "";
          const isAwsOffline = err.error === "aws_offline";
          const isHfUnconfigured = err.error === "hf_not_configured";
          // HuggingFace is scale-to-zero: a 503 / "service unavailable" / "loading" means the
          // endpoint is cold-starting, not a real failure. Show that plainly instead of "503".
          const isWarming =
            model === "hf" && /\b503\b|service unavailable|loading|warm/i.test(msg);
          const errorText = isAwsOffline
            ? "MedGemma box is offline — start it to use AWS."
            : isHfUnconfigured
              ? "HuggingFace endpoint is not configured."
              : isWarming
                ? "HuggingFace model is warming up (scale-to-zero cold start, ~1–2 min). Hit Retry in a moment."
                : err.message;

          setTranscript((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "assistant",
              text: errorText,
              model,
              error: err.error,
            },
          ]);
          if (isHfUnconfigured) {
            toast.error("HuggingFace not configured — switch to AWS MedGemma.");
          } else if (isWarming) {
            toast.info("HuggingFace model is warming up — Retry in a moment.");
          } else if (!isAwsOffline) {
            toast.error(err.message);
          }
          lastMetaRef.current = null;
        },
      },
    );
  };

  // Regenerate: re-send the last user prompt with current settings.
  const handleRegenerate = () => {
    if (!lastPromptRef.current || streaming) return;
    handleSend(lastPromptRef.current);
  };

  // ── Start box shortcut from ChatPanel ─────────────────────────────────────

  const handleStartBox = () => {
    api
      .post("/llm-playground/box", { action: "start" })
      .then(() => {
        toast.success("MedGemma box starting — takes ~2-3 min.");
        handleBoxAction();
      })
      .catch((err: unknown) => {
        const resp = (err as { response?: { data?: { error?: string; message?: string } } })
          ?.response?.data;
        toast.error(resp?.message ?? "Failed to start box");
      });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AdminLayout title="LLM Playground">
      <div className="flex flex-col gap-4 h-full">
        {/* Header bar: model switch + AWS box control */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {statusLoading ? (
            <Skeleton className="h-8 w-64" />
          ) : (
            <ModelSwitch
              model={model}
              awsState={status?.aws.state ?? "unconfigured"}
              hf={status?.hf ?? { configured: false }}
              disabled={streaming}
              onChange={(m) => {
                setModel(m);
                // Switching to AWS: refresh box status right away so the pill reflects reality.
                if (m === "aws") {
                  if (status?.aws.state === "unconfigured") {
                    toast.info("AWS MedGemma is not configured.");
                  } else {
                    fetchStatus().then(() => schedulePoll());
                  }
                }
              }}
            />
          )}

          {statusLoading ? (
            <Skeleton className="h-8 w-40" />
          ) : status ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">MedGemma box</span>
              <AwsBoxControl aws={status.aws} onActionDone={handleBoxAction} />
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Status unavailable</span>
          )}
        </div>

        {/* Info note */}
        <p className="text-sm text-muted-foreground max-w-2xl">
          Each message is stateless — conversation history is local display only.
          {!status?.hf.configured && (
            <span className={cn("ml-2 text-xs", "text-yellow-600")}>
              HuggingFace endpoint not configured.
            </span>
          )}
        </p>

        {/* Chat panel */}
        <div className="flex flex-col flex-1 min-h-0" style={{ minHeight: "500px" }}>
          <ChatPanel
            transcript={transcript}
            streamingText={streamingText}
            streaming={streaming}
            model={model}
            useRag={useRag}
            awsState={status?.aws.state ?? "unconfigured"}
            systemPrompt={systemPrompt}
            onSend={handleSend}
            onStop={stop}
            onStartBox={handleStartBox}
            onToggleRag={() => setUseRag((v) => !v)}
            onRegenerate={handleRegenerate}
            onSystemPromptChange={setSystemPrompt}
          />
        </div>
      </div>
    </AdminLayout>
  );
}
