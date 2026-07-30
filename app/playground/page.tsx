"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AdminLayout } from "@/components/AdminLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { UserRound } from "lucide-react";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { ModelSwitch } from "./ModelSwitch";
import { AwsBoxControl } from "./AwsBoxControl";
import { ChatPanel } from "./ChatPanel";
import { ConversationSidebar } from "./ConversationSidebar";
import { useChatStream } from "./useChatStream";
import type {
  LlmModel,
  PlaygroundStatus,
  TranscriptEntry,
  RagSource,
  AwsState,
  ChatMessage,
  ConversationSummary,
  ConversationDetail,
} from "./types";
import { isTransitioning } from "./types";
import { InfoTip } from "@/components/InfoTip";

// Poll every 10s during transitions / after a box action.
const POLL_MS = 10_000;
// Steady-state refresh so the status pill never goes stale (box may be started/stopped elsewhere).
const IDLE_POLL_MS = 30_000;
// Max polls after a box action (~3 min / 10s = 18).
const MAX_POST_ACTION_POLLS = 18;

let entryCounter = 0;
const nextId = () => String(++entryCounter);

/** One de-identified patient in an account's by-user list. */
interface PatientChoice {
  id: string;
  label: string;
}

const PATIENT_CONV_KEY = "jiive_conv_patients_v1";
function getPatientMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(PATIENT_CONV_KEY) ?? "{}"); } catch { return {}; }
}
function saveConvPatient(convId: string, patientId: string) {
  const map = getPatientMap(); map[convId] = patientId;
  localStorage.setItem(PATIENT_CONV_KEY, JSON.stringify(map));
}

const MODEL_CONV_KEY = "jiive_conv_model_v1";
function getModelMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(MODEL_CONV_KEY) ?? "{}"); } catch { return {}; }
}
function saveConvModel(convId: string, model: string) {
  const map = getModelMap(); map[convId] = model;
  localStorage.setItem(MODEL_CONV_KEY, JSON.stringify(map));
}

/**
 * Build the `messages` array from transcript entries to send to the backend.
 * Rules (from backend contract):
 *  - user entries → role "user"
 *  - assistant entries that are NOT errors AND have non-whitespace content → role "assistant"
 *    (include `stopped` partials — they carry real content the model should remember)
 *  - error entries are excluded entirely
 *  - system-role entries must NOT be included (backend drops them)
 */
function buildMessages(entries: TranscriptEntry[]): ChatMessage[] {
  return entries.flatMap<ChatMessage>((entry) => {
    if (entry.role === "user") {
      return [{ role: "user", content: entry.text }];
    }
    // assistant: skip errors and empty/whitespace content
    if (entry.error || !entry.text.trim()) return [];
    return [{ role: "assistant", content: entry.text }];
  });
}

export default function PlaygroundPage() {
  const router = useRouter();
  // Guard: consume ?userId= deep-link exactly once on mount.
  const deepLinkConsumedRef = useRef(false);

  const [model, setModel] = useState<LlmModel>("openai");
  const [useRag, setUseRag] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [streamingText, setStreamingText] = useState("");
  /** De-identified patient id attached to the current chat. Never PII — only the uuid. */
  const [activePatientId, setActivePatientId] = useState<string | null>(null);

  // lastMeta is tracked on the streaming assistant entry (used by onDone/onAbort).
  // Stored in a ref so it doesn't cause re-renders on every token.

  const [status, setStatus] = useState<PlaygroundStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  // True while the deep-link patient fetch is in flight — blocks the composer (Bug F).
  const [deepLinkPending, setDeepLinkPending] = useState(false);
  // When a profile deep-link resolves to an account with several patients, we ask
  // the operator which one — never guess, never blend.
  const [accountPatients, setAccountPatients] = useState<PatientChoice[] | null>(null);

  // Conversation history state
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [activeConvIsOwner, setActiveConvIsOwner] = useState(true);
  const conversationIdRef = useRef<string | null>(null); // source-of-truth; state is mirror for rendering
  const activePatientIdRef = useRef<string | null>(null);
  const convCreateInFlightRef = useRef(false); // duplicate-create guard

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

  // ── Fetch conversation list ───────────────────────────────────────────────

  const fetchConversations = useCallback(() => {
    api
      .get<ConversationSummary[]>("/llm-playground/conversations")
      .then((r) => setConversations(r.data))
      .catch(() => { /* silent */ });
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
    fetchConversations();
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Deep-link: ?patientId= (one person) or ?userId= (an account) ──────────
  // Runs once on mount. Does not interfere with handleNewChat / handleOpenConversation
  // because it fires before any conversation is created (transcript is empty on mount).
  //
  // ?patientId= is the precise one — it loads exactly one FamilyMember's context
  // (from the Results tab's per-patient "Ask AI"). ?userId= is the account-level
  // link (the profile button); the backend resolves that to a patient. When both
  // are present, patientId wins — it's the more specific target.

  useEffect(() => {
    if (deepLinkConsumedRef.current) return;
    // Read directly from window.location — avoids useSearchParams Suspense requirement
    // while still running only client-side (this is a "use client" component).
    const qs = new URLSearchParams(window.location.search);
    const patientId = qs.get("patientId");
    const userId = qs.get("userId");
    if (!patientId && !userId) return;
    deepLinkConsumedRef.current = true;
    // Strip params immediately so a refresh or sidebar open doesn't re-trigger.
    router.replace("/playground");
    setDeepLinkPending(true);

    const pick = (id: string) => {
      setActivePatientId(id);
      activePatientIdRef.current = id;
    };

    if (patientId) {
      // Precise: one FamilyMember's context (from the Results-tab per-patient button).
      api
        .get<{ id: string }>(`/llm-playground/patients/by-patient/${patientId}`)
        .then((resp) => pick(resp.data.id))
        .catch(() => toast.info("No patient record available for this link."))
        .finally(() => setDeepLinkPending(false));
    } else {
      // Account-level (the profile button). An account is a household, so this
      // returns a LIST — one de-identified context per family member. Auto-load a
      // lone patient; let the operator choose when there's more than one, rather
      // than silently pick one (or worse, blend them — the old bug).
      api
        .get<{ patients: PatientChoice[] }>(`/llm-playground/patients/by-user/${userId}`)
        .then((resp) => {
          const list = resp.data.patients ?? [];
          if (list.length === 0) {
            toast.info("No patient record available for this user in the playground.");
          } else if (list.length === 1) {
            pick(list[0].id);
          } else {
            setAccountPatients(list);
          }
        })
        .catch(() => toast.info("No patient record available for this link."))
        .finally(() => setDeepLinkPending(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Called by AwsBoxControl after a successful box action.
  const handleBoxAction = useCallback(() => {
    postActionPollsRef.current = MAX_POST_ACTION_POLLS;
    fetchStatus().then(() => { schedulePoll(); });
  }, [fetchStatus, schedulePoll]);

  // ── Model + patient persistence ───────────────────────────────────────────

  const patientLocked = transcript.length > 0;
  const modelLocked = transcript.length > 0;

  const handleModelChange = useCallback((m: LlmModel) => {
    setModel(m);
    const convId = conversationIdRef.current;
    if (convId) saveConvModel(convId, m);
    if (m === "aws") {
      if (status?.aws.state === "unconfigured") {
        toast.info("AWS MedGemma is not configured.");
      } else {
        fetchStatus().then(() => schedulePoll());
      }
    }
  }, [status, fetchStatus, schedulePoll]);

  const handlePatientChange = useCallback((id: string | null) => {
    activePatientIdRef.current = id;
    setActivePatientId(id);
    const convId = conversationIdRef.current;
    if (convId && id) saveConvPatient(convId, id);
  }, []);

  // ── Chat ─────────────────────────────────────────────────────────────────

  // Stores the meta payload from the current stream so onDone can access ragSources + ragError.
  const lastMetaRef = useRef<{ ragSources?: RagSource[] | null; ragError?: string } | null>(null);

  // ── Auto-save upsert ─────────────────────────────────────────────────────

  const upsertConversation = useCallback(
    (entries: TranscriptEntry[]) => {
      const saved = buildMessages(entries);
      if (saved.length === 0) return; // nothing worth saving

      const currentId = conversationIdRef.current;
      if (currentId) {
        // PATCH existing
        api
          .patch(`/llm-playground/conversations/${currentId}`, { messages: saved })
          .catch(() => { toast.error("Conversation autosave failed"); });
      } else {
        // POST new — guard against duplicate creates
        if (convCreateInFlightRef.current) return;
        convCreateInFlightRef.current = true;
        const firstUser = entries.find((e) => e.role === "user");
        const title = firstUser ? firstUser.text.trim().slice(0, 60) : "Conversation";
        api
          .post<ConversationDetail>("/llm-playground/conversations", { title, messages: saved })
          .then((r) => {
            conversationIdRef.current = r.data.id;
            setActiveConvId(r.data.id);
            const pid = activePatientIdRef.current;
            if (pid) saveConvPatient(r.data.id, pid);
            saveConvModel(r.data.id, model);
            fetchConversations();
          })
          .catch(() => { toast.error("Conversation autosave failed"); })
          .finally(() => { convCreateInFlightRef.current = false; });
      }
    },
    [fetchConversations],
  );

  /**
   * Core send routine. Accepts the transcript to use for building messages
   * (caller passes the desired state, which may not yet be in React state).
   */
  const sendWithTranscript = useCallback(
    (entriesForContext: TranscriptEntry[], currentModel: LlmModel) => {
      const messages = buildMessages(entriesForContext);
      let accumText = "";
      const assistantId = nextId();
      lastMetaRef.current = null;
      setStreamingText("");

      send(
        {
          messages,
          model: currentModel,
          useRag,
          systemPrompt: systemPrompt.trim() || undefined,
          // Only ever send the id — backend injects de-identified context server-side.
          patientId: activePatientId ?? undefined,
          conversationId: conversationIdRef.current ?? undefined,
        },
        {
          onMeta(meta) {
            lastMetaRef.current = { ragSources: meta.ragSources, ragError: meta.ragError };
            accumText = "";
            setStreamingText("");
          },
          onToken(delta) {
            accumText += delta;
            setStreamingText(accumText);
          },
          onDone(done) {
            setStreamingText("");
            const assistantEntry: TranscriptEntry = {
              id: assistantId,
              role: "assistant",
              text: accumText,
              model: currentModel,
              ragSources: lastMetaRef.current?.ragSources ?? null,
              ragError: lastMetaRef.current?.ragError ?? undefined,
              latencyMs: done.latencyMs,
              promptTokens: done.promptTokens,
              completionTokens: done.completionTokens,
            };
            setTranscript((prev) => [...prev, assistantEntry]);
            // entriesForContext already has the user turn; build with the assistant entry appended
            upsertConversation([...entriesForContext, assistantEntry]);
            lastMetaRef.current = null;
          },
          onAbort(partialText, partialMeta) {
            // Commit whatever streamed so far as a stopped message.
            setStreamingText("");
            if (!partialText.trim()) {
              lastMetaRef.current = null;
              return; // nothing to save if stopped immediately with no content
            }
            const stoppedEntry: TranscriptEntry = {
              id: assistantId,
              role: "assistant",
              text: partialText,
              model: currentModel,
              ragSources: partialMeta?.ragSources ?? lastMetaRef.current?.ragSources ?? null,
              stopped: true,
            };
            setTranscript((prev) => [...prev, stoppedEntry]);
            upsertConversation([...entriesForContext, stoppedEntry]);
            lastMetaRef.current = null;
          },
          onError(err) {
            setStreamingText("");
            const msg = err.message ?? "";
            const isAwsOffline =
              err.error === "aws_offline" ||
              (currentModel === "aws" && /request timed out|timed out/i.test(msg));
            const isHfUnconfigured = err.error === "hf_not_configured";
            const isOpenAiUnconfigured = err.error === "openai_not_configured";
            const isPatientNotFound = err.error === "patient_not_found";
            const isUnexpectedClose =
              err.error === "provider_error" && msg === "Connection closed unexpectedly.";
            // HuggingFace is scale-to-zero: a 503 / "service unavailable" / "loading" means the
            // endpoint is cold-starting, not a real failure. Show that plainly instead of "503".
            const isWarming =
              currentModel === "hf" && /\b503\b|service unavailable|loading|warm/i.test(msg);
            const isBackend500 = /internal server error|HTTP 5\d\d/i.test(msg);
            const errorText = isAwsOffline
              ? "MedGemma box is offline — start it to use AWS."
              : isHfUnconfigured
                ? "HuggingFace endpoint is not configured."
                : isOpenAiUnconfigured
                ? "OpenAI is not configured on this environment."
                : isPatientNotFound
                  ? "That patient could not be found — pick another."
                  : isWarming
                    ? "HuggingFace model is warming up (scale-to-zero cold start, ~1–2 min). Hit Retry in a moment."
                    : isUnexpectedClose
                      ? "Connection closed unexpectedly — please retry."
                      : isBackend500
                        ? "Something went wrong on the server — please retry in a moment."
                        : err.message;

            // Auto-clear a bad patient selection so the operator isn't stuck.
            if (isPatientNotFound) {
              setActivePatientId(null);
            }

            setTranscript((prev) => [
              ...prev,
              {
                id: nextId(),
                role: "assistant",
                text: errorText,
                model: currentModel,
                error: err.error,
              },
            ]);
            if (isHfUnconfigured) {
              toast.error("HuggingFace not configured — switch to AWS MedGemma.");
            } else if (isPatientNotFound) {
              toast.error("Patient not found — selection cleared, pick another.");
            } else if (isWarming) {
              toast.info("HuggingFace model is warming up — Retry in a moment.");
            } else if (isBackend500) {
              toast.error("Server error — please retry.");
            } else if (!isAwsOffline && !isUnexpectedClose) {
              toast.error(err.message);
            }
            lastMetaRef.current = null;
          },
        },
      );
    },
    [send, useRag, systemPrompt, upsertConversation, activePatientId],
  );

  const handleSend = (prompt: string) => {
    // If AWS box is clearly offline, show an instant error without a 31s API wait.
    if (model === "aws" && status?.aws.state === "stopped") {
      const uid = nextId();
      const errorId = nextId();
      setTranscript((prev) => [
        ...prev,
        { id: uid, role: "user", text: prompt },
        { id: errorId, role: "assistant", text: "MedGemma box is offline — start it to use AWS.", model: "aws" as LlmModel, error: "aws_offline" },
      ]);
      return;
    }
    const userEntry: TranscriptEntry = { id: nextId(), role: "user", text: prompt };
    // Append the user entry first so it's included in the messages array.
    const nextTranscript = [...transcript, userEntry];
    setTranscript(nextTranscript);
    sendWithTranscript(nextTranscript, model);
  };

  const handleEdit = useCallback((entryId: string, newText: string) => {
    if (streaming) return;
    // Find the index of the user entry being edited.
    const idx = transcript.findIndex((e) => e.id === entryId);
    if (idx === -1) return;
    const editedEntry: TranscriptEntry = { id: nextId(), role: "user", text: newText };
    // Keep everything before the edited turn, then the new version.
    const trimmed = [...transcript.slice(0, idx), editedEntry];
    setTranscript(trimmed);
    sendWithTranscript(trimmed, model);
  }, [streaming, transcript, model, sendWithTranscript]);

  /**
   * Regenerate: drop the trailing assistant entry being regenerated, then
   * rebuild messages ending at the last user turn and re-send.
   * Works for both normal answers and stopped partials.
   */
  const handleRegenerate = () => {
    if (streaming) return;
    // Drop the LAST assistant entry — whether it's a real answer (Regenerate),
    // a stopped partial, or an error bubble (Retry). In every case the remaining
    // transcript ends at the user turn we want to re-answer.
    let dropIdx = -1;
    for (let i = transcript.length - 1; i >= 0; i--) {
      if (transcript[i].role === "assistant") {
        dropIdx = i;
        break;
      }
    }
    if (dropIdx === -1) return; // nothing to regenerate
    const trimmed = transcript.slice(0, dropIdx);
    // Don't send if there are no user turns left to re-answer.
    if (buildMessages(trimmed).length === 0) return;
    setTranscript(trimmed);
    sendWithTranscript(trimmed, model);
  };

  /**
   * New chat: clear the transcript and streaming state.
   * Model, useRag, and systemPrompt settings are preserved.
   * Active patient is also cleared — it is not persisted in conversation history.
   */
  const handleNewChat = useCallback(() => {
    if (streaming) return;
    setTranscript([]);
    setStreamingText("");
    lastMetaRef.current = null;
    conversationIdRef.current = null;
    setActiveConvId(null);
    setActiveConvIsOwner(true);
    setActivePatientId(null);
    activePatientIdRef.current = null;
    convCreateInFlightRef.current = false;
  }, [streaming]);

  /**
   * Open a conversation from history.
   * Active patient is cleared — conversations do not persist patient selection.
   */
  const handleOpenConversation = useCallback((id: string) => {
    if (streaming) return;
    api
      .get<ConversationDetail>(`/llm-playground/conversations/${id}`)
      .then((r) => {
        // Reconstruct transcript entries from saved messages
        const entries: TranscriptEntry[] = r.data.messages.map((m, i) => ({
          id: `conv-${r.data.id}-${i}`,
          role: m.role,
          text: m.content,
        }));
        setTranscript(entries);
        setStreamingText("");
        lastMetaRef.current = null;
        conversationIdRef.current = r.data.id;
        setActiveConvId(r.data.id);
        setActiveConvIsOwner(r.data.isOwner ?? true);
        const savedPatientId = getPatientMap()[id] ?? null;
        setActivePatientId(savedPatientId);
        activePatientIdRef.current = savedPatientId;
        const savedModel = getModelMap()[id] as LlmModel | undefined;
        if (savedModel) setModel(savedModel);
      })
      .catch(() => { toast.error("Failed to load conversation"); });
  }, [streaming]);

  /**
   * Delete a conversation from history.
   */
  const handleDeleteConversation = useCallback((id: string) => {
    api
      .delete(`/llm-playground/conversations/${id}`)
      .then(() => {
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (conversationIdRef.current === id) {
          handleNewChat();
        }
      })
      .catch(() => { toast.error("Failed to delete conversation"); });
  }, [handleNewChat]);

  // ── Rename a conversation ─────────────────────────────────────────────────

  const handleRenameConversation = useCallback((id: string, title: string) => {
    // Optimistic update
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c)),
    );
    api
      .patch(`/llm-playground/conversations/${id}`, { title })
      .catch(() => {
        // Revert: re-fetch the list so the old title is restored
        fetchConversations();
        toast.error("Couldn't rename chat");
      });
  }, [fetchConversations]);

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
      <div className="flex gap-4 h-full min-h-0">
        {/* Conversation history sidebar */}
        <ConversationSidebar
          conversations={conversations}
          activeId={activeConvId}
          streaming={streaming}
          onNew={handleNewChat}
          onOpen={handleOpenConversation}
          onDelete={handleDeleteConversation}
          onRename={handleRenameConversation}
        />

        {/* Main content */}
        <div className="flex flex-col gap-4 flex-1 min-w-0 h-full">
          {/* Header bar: model switch + AWS box control */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {statusLoading ? (
              <Skeleton className="h-8 w-64" />
            ) : (
              <div className="flex items-center gap-2">
                <ModelSwitch
                  model={model}
                  awsState={status?.aws.state ?? "unconfigured"}
                  hf={status?.hf ?? { configured: false }}
                  disabled={streaming || modelLocked}
                  onChange={handleModelChange}
                />
                {modelLocked && (
                  <span className="text-[10px] text-muted-foreground">· fixed to chat</span>
                )}
              </div>
            )}

            {statusLoading ? (
              <Skeleton className="h-8 w-40" />
            ) : status ? (
              model === "aws" ? (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">MedGemma box</span>
                  <InfoTip
                    label="The dedicated AI server. It costs ~$1/hour while running, so start it when testing AWS and stop it when done."
                    side="bottom"
                  />
                  <AwsBoxControl aws={status.aws} onActionDone={handleBoxAction} />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">HuggingFace</span>
                  <InfoTip
                    label="Hosted HuggingFace inference endpoint. Scale-to-zero: first message after idle may take ~1–2 min to warm up."
                    side="bottom"
                  />
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                      status.hf.configured
                        ? "border-green-200 bg-green-50 text-green-700"
                        : "border-yellow-200 bg-yellow-50 text-yellow-700",
                    )}
                  >
                    {status.hf.configured ? "Configured" : "Not configured"}
                  </span>
                </div>
              )
            ) : (
              <span className="text-xs text-muted-foreground">Status unavailable</span>
            )}
          </div>

          {/* Info note */}
          <p className="text-sm text-muted-foreground max-w-2xl">
            Conversation context is kept within this chat — start a New chat to reset.
            {model === "hf" && !status?.hf.configured && (
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
              defaultSystemPrompt={status?.defaultSystemPrompt ?? ""}
              patientId={activePatientId}
              patientLocked={patientLocked}
              isOwner={activeConvIsOwner}
              composerDisabled={deepLinkPending}
              onSend={handleSend}
              onStop={stop}
              onStartBox={handleStartBox}
              onToggleRag={() => setUseRag((v) => !v)}
              onRegenerate={handleRegenerate}
              onSystemPromptChange={setSystemPrompt}
              onPatientChange={handlePatientChange}
              onEdit={handleEdit}
            />
          </div>
        </div>
      </div>

      {/* Account has several patients → choose which one's context to load. Labels
          are de-identified (age band + bio-age); no names reach the playground. */}
      <Dialog open={accountPatients !== null} onOpenChange={(o) => { if (!o) setAccountPatients(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Which patient?</DialogTitle>
            <DialogDescription>
              This account has more than one patient. Pick whose results the AI should look at —
              each is loaded on its own, never blended.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {(accountPatients ?? []).map((p) => (
              <Button
                key={p.id}
                variant="outline"
                className="h-auto justify-start gap-2 py-2.5 text-left"
                onClick={() => {
                  setActivePatientId(p.id);
                  activePatientIdRef.current = p.id;
                  setAccountPatients(null);
                }}
              >
                <UserRound size={15} className="shrink-0 text-muted-foreground" />
                <span className="text-sm">{p.label}</span>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
