"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Hammer,
  Loader2,
  MessageSquare,
  Phone,
  RotateCw,
  Sparkles,
  User,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoTip } from "@/components/InfoTip";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/app/incidents/lib/datetime";
import {
  feedbackErrorMessage,
  getCustomerNote,
  isNotBuiltYet,
  logFeedback,
  organizeCustomerNote,
} from "../api";
import {
  CHANNEL_HINT,
  CHANNEL_LABEL,
  FEEDBACK_CHANNELS,
  ORGANIZED_EXPLAINER,
  type CustomerNote,
  type FeedbackChannel,
} from "../types";

const CHANNEL_ICON: Record<FeedbackChannel, LucideIcon> = {
  in_person: User,
  call: Phone,
  text: MessageSquare,
};

// Background organize is async server-side. After a dump is saved (or a manual
// re-organize), poll a small fixed number of times to pick up the refreshed note,
// then stop — never an infinite poll.
const POLL_MS = 3000;
const MAX_POLLS = 5;

export default function CustomerNotePage() {
  const params = useParams<{ userId: string }>();
  const router = useRouter();
  const userId = params?.userId;

  const [note, setNote] = useState<CustomerNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notBuilt, setNotBuilt] = useState(false);

  const [showDumps, setShowDumps] = useState(false);

  // Add-to-this box.
  const [addNotes, setAddNotes] = useState("");
  const [addChannel, setAddChannel] = useState<FeedbackChannel | null>(null);
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);

  const [reorganizing, setReorganizing] = useState(false);

  // Polling machinery — a timer ref plus a fetch counter, both cancellable.
  const [polling, setPolling] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTries = useRef(0);

  const stopPoll = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    setPolling(false);
  }, []);

  // Fetch immediately, then up to MAX_POLLS times total, POLL_MS apart. Stops the
  // moment the note is no longer "pending" (organized ok, or failed).
  const runPoll = useCallback(() => {
    if (!userId) return;
    stopPoll();
    pollTries.current = 0;
    setPolling(true);
    const fetchOnce = () => {
      pollTries.current += 1;
      getCustomerNote(userId)
        .then((fresh) => {
          setNote(fresh);
          if (fresh.organizeStatus !== "pending" || pollTries.current >= MAX_POLLS) {
            stopPoll();
          } else {
            pollTimer.current = setTimeout(fetchOnce, POLL_MS);
          }
        })
        .catch(() => stopPoll()); // transient error — stop politely; the note stays readable.
    };
    fetchOnce();
  }, [userId, stopPoll]);

  const load = useCallback(() => {
    if (!userId) return;
    setLoading(true);
    getCustomerNote(userId)
      .then((n) => { setNote(n); setError(null); setNotBuilt(false); })
      .catch((err: unknown) => {
        setNote(null);
        setNotBuilt(isNotBuiltYet(err));
        setError(feedbackErrorMessage(err));
      })
      .finally(() => setLoading(false));
  }, [userId]);

  // Deferred a tick so setLoading isn't called synchronously in the effect body
  // (which cascades an extra render — same reason app/incidents defers its load).
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  // Clear any in-flight poll on unmount (without touching state post-unmount).
  useEffect(() => () => { if (pollTimer.current) clearTimeout(pollTimer.current); }, []);

  // The add-box channel defaults to the most recent dump's channel — most feedback
  // from one customer arrives the same way. Derived, not stored, so there's no
  // setState-in-effect: an explicit pick (`addChannel`) always wins, and until then
  // the default shows through. Null only when the customer has no dumps yet.
  const effectiveChannel: FeedbackChannel | null = addChannel ?? note?.dumps[0]?.channel ?? null;

  const addNotesEmpty = addNotes.trim() === "";
  const addBlocker: string | null =
    effectiveChannel === null
      ? "Choose how they told us."
      : addNotesEmpty
      ? "Type what they said."
      : null;

  async function addDump() {
    if (addingRef.current || !userId || effectiveChannel === null || addNotesEmpty) return;
    addingRef.current = true;
    setAdding(true);
    try {
      await logFeedback({ userId, channel: effectiveChannel, notes: addNotes });
      setAddNotes("");
      // Show it's organizing at once; the poll picks up the new dump + refreshed text.
      setNote((n) => (n ? { ...n, organizeStatus: "pending" } : n));
      toast.success("Added — organizing the note…");
      runPoll();
    } catch (err) {
      // Keep the typed text on failure — a blip must never cost the operator their words.
      toast.error(feedbackErrorMessage(err));
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  }

  async function reorganize() {
    if (reorganizing || polling || !userId) return;
    setReorganizing(true);
    try {
      const r = await organizeCustomerNote(userId);
      setNote((n) =>
        n
          ? {
              ...n,
              organizeStatus: r.organizeStatus,
              organizedText: r.organizedText || n.organizedText,
              organizedAt: r.organizedAt ?? n.organizedAt,
            }
          : n
      );
      if (r.organizeStatus === "pending") runPoll();
      else toast.success(r.organizeStatus === "failed" ? "Still couldn't organize" : "Note refreshed");
    } catch (err) {
      toast.error(feedbackErrorMessage(err));
    } finally {
      setReorganizing(false);
    }
  }

  const status = note?.organizeStatus;

  return (
    <AdminLayout title="Feedback">
      <div className="flex flex-col gap-5 pb-24 sm:pb-8">
        <button
          type="button"
          onClick={() => router.push("/feedback")}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft size={14} />
          All feedback
        </button>

        {loading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-40" />
            <Skeleton className="h-32" />
          </div>
        ) : notBuilt ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card/60 px-6 py-10 text-center">
            <Hammer size={22} className="text-muted-foreground" />
            <span className="text-sm font-medium">The feedback API isn&apos;t available yet</span>
            <span className="max-w-md text-sm text-muted-foreground">
              The backend is being built in parallel. This customer&apos;s living note will load the
              moment it ships.
            </span>
            <Button variant="outline" size="sm" onClick={load}>Retry</Button>
          </div>
        ) : error ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-4">
            <span className="text-sm font-medium text-destructive">Couldn&apos;t load this note</span>
            <span className="text-sm text-muted-foreground">{error}</span>
            <Button variant="outline" size="sm" onClick={load}>Retry</Button>
          </div>
        ) : note ? (
          <>
            <h1 className="text-lg font-semibold">{note.userName || "Unknown customer"}</h1>

            {/* ── The AI-organized living note ─────────────────────────────── */}
            <section className="flex flex-col gap-2.5 rounded-xl border border-border bg-card/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Sparkles size={13} className="text-muted-foreground" />
                  Organized note
                  <InfoTip label={ORGANIZED_EXPLAINER} />
                </span>
                {status === "pending" || polling ? (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 size={12} className="animate-spin" />
                    Organizing…
                  </span>
                ) : status === "failed" ? (
                  <span className="text-xs text-amber-500">Couldn&apos;t organize</span>
                ) : note.organizedAt ? (
                  <span className="text-xs text-muted-foreground">
                    Updated {formatDateTime(note.organizedAt)}
                  </span>
                ) : null}
              </div>

              {note.organizedText ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{note.organizedText}</p>
              ) : status === "pending" || polling ? (
                <p className="text-sm italic text-muted-foreground">
                  Folding in what you just added — this updates in a few seconds.
                </p>
              ) : status === "failed" ? (
                <p className="text-sm text-muted-foreground">
                  The summary couldn&apos;t be generated. Your raw dumps below are safe and complete —
                  re-organize to try again.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No summary yet. Add a dump below, or re-organize to build one from existing dumps.
                </p>
              )}

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={reorganizing || polling}
                  onClick={() => void reorganize()}
                  title={polling ? "Already organizing…" : undefined}
                >
                  {reorganizing ? (
                    <><Loader2 size={13} className="mr-1.5 animate-spin" />Re-organizing…</>
                  ) : (
                    <><RotateCw size={13} className="mr-1.5" />Re-organize</>
                  )}
                </Button>
              </div>
            </section>

            {/* ── Add to this ─────────────────────────────────────────────── */}
            <section className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/[0.04] p-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Add to this note</span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Sparkles size={12} className="shrink-0 text-primary" />
                  Dump more — AI folds it into the note above and improves it. Your raw words stay below.
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {FEEDBACK_CHANNELS.map((c) => {
                  const Icon = CHANNEL_ICON[c];
                  const active = effectiveChannel === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={active}
                      disabled={adding}
                      onClick={() => setAddChannel(c)}
                      title={CHANNEL_HINT[c]}
                      className={cn(
                        "flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl border text-center transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                        active
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-card text-muted-foreground hover:bg-accent"
                      )}
                    >
                      <Icon size={16} />
                      <span className="text-xs font-medium">{CHANNEL_LABEL[c]}</span>
                    </button>
                  );
                })}
              </div>

              <textarea
                value={addNotes}
                onChange={(e) => setAddNotes(e.target.value)}
                disabled={adding}
                rows={4}
                placeholder="What did they tell you this time? Their words, or your understanding of them…"
                className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-base leading-relaxed transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm dark:bg-input/30"
              />

              <div className="flex flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:justify-end sm:gap-2">
                {addBlocker && (
                  <span className="text-xs text-muted-foreground sm:mr-auto">{addBlocker}</span>
                )}
                <Button
                  disabled={adding || addBlocker !== null}
                  title={addBlocker ?? undefined}
                  onClick={() => void addDump()}
                  className="h-11 text-base sm:h-9 sm:text-sm"
                >
                  {adding ? (
                    <><Loader2 size={14} className="mr-2 animate-spin" />Saving…</>
                  ) : (
                    <><Sparkles size={14} className="mr-1.5" />Add &amp; organize</>
                  )}
                </Button>
              </div>
            </section>

            {/* ── Original dumps (always reachable) ────────────────────────── */}
            <section className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setShowDumps((s) => !s)}
                aria-expanded={showDumps}
                className="flex w-fit items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {showDumps ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                {showDumps ? "Hide" : "Show"} original dumps
                <span className="text-xs font-normal text-muted-foreground/70">
                  ({note.dumps.length} verbatim)
                </span>
              </button>

              {showDumps &&
                (note.dumps.length === 0 ? (
                  <span className="text-xs text-muted-foreground">No dumps recorded.</span>
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {note.dumps.map((d) => {
                      const Icon = CHANNEL_ICON[d.channel];
                      return (
                        <li
                          key={d.id}
                          className="rounded-xl border border-border bg-card/60 p-3.5"
                        >
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                            <span
                              className="inline-flex items-center gap-1"
                              title={CHANNEL_LABEL[d.channel]}
                            >
                              {Icon ? <Icon size={13} /> : null}
                              {CHANNEL_LABEL[d.channel]}
                            </span>
                            <span>·</span>
                            <span>{formatDateTime(d.createdAt)}</span>
                            {d.loggedByLabel && (
                              <>
                                <span>·</span>
                                <span>by {d.loggedByLabel}</span>
                              </>
                            )}
                          </div>
                          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">
                            {d.notes}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                ))}
            </section>
          </>
        ) : null}
      </div>
    </AdminLayout>
  );
}
