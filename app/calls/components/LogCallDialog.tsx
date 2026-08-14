"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Loader2, Phone, Quote } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InfoTip } from "@/components/InfoTip";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { datetimeLocalToIso, toDatetimeLocalValue } from "@/app/incidents/lib/datetime";
import { callErrorMessage, logCall } from "../api";
import {
  ATTEMPTS_EXPLAINER,
  CALLBACK_NOTE,
  consentScript,
  CSAT_EXPLAINER,
  CSAT_LABEL,
  CSAT_SCRIPT,
  CSAT_VALUES,
  DISPOSITION_HINT,
  DISPOSITION_LABEL,
  DNC_EXPLAINER,
  enumLabel,
  FOLLOW_UP_SCRIPT,
  isIssueTag,
  TAGS_EXPLAINER,
  telHref,
  type CallDisposition,
  type CallQueueRow,
  type CsatValue,
  type LogCallRequest,
} from "../types";
import { useCallMeta } from "../lib/useCallMeta";
import { AttemptBadge, QueueReasonBadge } from "./CallBadges";
import { PreviousCallsList } from "./PreviousCallsList";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: CallQueueRow;
  /** Fired after a call is logged. A terminal disposition drops the row — refetch. */
  onLogged: () => void;
}

/**
 * Which step of the call screen we're on.
 *
 * `disposition` is the ONLY step a failed call ever sees: tapping no-answer,
 * unreachable, refused or wrong-number saves and closes from there, in one tap.
 * That is the single most important decision in this feature — if logging a
 * no-answer is fiddly, no-answers stop being logged and attempt-tracking
 * silently becomes fiction.
 *
 * The two exceptions each exist for a hard reason, not for tidiness:
 *   `callback` → the server REQUIRES callbackAt, so we must ask when.
 *   `do_not_contact` → it is a permanent consent withdrawal, so it is confirmed.
 */
type Stage = "disposition" | "callback" | "confirm-dnc" | "connected";

/** One tap, saved, gone. Everything not in here needs a second step. */
function isOneTap(d: CallDisposition): boolean {
  return d !== "connected" && d !== "callback" && d !== "do_not_contact";
}

const DISPOSITION_TILE: Partial<Record<CallDisposition, string>> = {
  connected: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20",
  do_not_contact: "border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20",
};

/** Tomorrow, same time — the most likely callback slot, and one edit from any other. */
function defaultCallbackValue(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toDatetimeLocalValue(d);
}

export function LogCallDialog({ open, onOpenChange, row, onLogged }: Props) {
  // Dispositions and the tag vocabulary come from the server. A failed meta call
  // still leaves the seven buttons usable (they're fixed by contract); it only
  // costs the tag chips, and it says so rather than pretending.
  const { meta, degraded: metaDegraded } = useCallMeta();
  const { name: adminName } = useAuth();

  const [stage, setStage] = useState<Stage>("disposition");
  const [csat, setCsat] = useState<CsatValue | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [verbatim, setVerbatim] = useState("");
  const [resolved, setResolved] = useState(false);
  const [callbackAt, setCallbackAt] = useState(defaultCallbackValue);
  const [submitting, setSubmitting] = useState(false);
  // Guards a second submit fired before the first response lands. On a phone,
  // double-tapping a big button is easy, and a duplicate call log is a lie about
  // how many times we rang someone.
  const submittingRef = useRef(false);

  const notesRef = useRef<HTMLTextAreaElement>(null);

  // Whether the picked callback time is in the past. Computed in the change
  // handler (event handlers may read the clock; render may not — Date.now() and
  // ref reads during render both break React's concurrent rules) and stored as a
  // plain boolean the render can use.
  const [callbackInPast, setCallbackInPast] = useState(false);
  function onCallbackChange(value: string) {
    setCallbackAt(value);
    const iso = datetimeLocalToIso(value);
    setCallbackInPast(iso !== null && new Date(iso).getTime() < Date.now());
  }

  // Focus the notes box the moment a CSAT score is in — the caller is typing
  // while still saying goodbye. NOT on entering Stage 2: on a phone that pops the
  // keyboard straight over the CSAT buttons, which are the one required field.
  useEffect(() => {
    if (stage === "connected" && csat !== null) notesRef.current?.focus();
  }, [stage, csat]);

  const dial = telHref(row.phone);
  const maxAttempts = row.maxAttempts || meta.maxAttempts;
  const hasIncident = row.incident !== null;
  // The Resolved toggle only makes sense against something that WENT WRONG. Show
  // it when a problem tag is picked, or when this call is closing the loop on an
  // incident. It is never sent unless the caller actually turns it on.
  const showResolved = hasIncident || tags.some(isIssueTag);

  async function submit(disposition: CallDisposition, extra: Partial<LogCallRequest> = {}) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await logCall({
        userId: row.userId,
        queueReason: row.queueReason,
        disposition,
        bookingId: row.bookingId,
        incidentId: row.incident?.id,
        ...extra,
      });
      toast.success(
        disposition === "do_not_contact"
          ? `${row.userName} will never be called again.`
          : `Logged: ${enumLabel(DISPOSITION_LABEL, disposition)}.`
      );
      onLogged();
      onOpenChange(false);
    } catch (err: unknown) {
      // Stay open with every field intact. The customer may still be on the line,
      // and a network blip must never cost the caller the notes they just took.
      toast.error(callErrorMessage(err));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function handleDisposition(d: CallDisposition) {
    if (isOneTap(d)) {
      void submit(d);
      return;
    }
    if (d === "callback") setStage("callback");
    else if (d === "do_not_contact") setStage("confirm-dnc");
    else setStage("connected");
  }

  const callbackIso = datetimeLocalToIso(callbackAt);

  function toggleTag(value: string) {
    setTags((t) => (t.includes(value) ? t.filter((x) => x !== value) : [...t, value]));
  }

  const connectedBlocker: string | null =
    csat === null ? "Read the CSAT question and tap their score." : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitting) onOpenChange(o); }}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92dvh] w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{row.userName}</span>
            <QueueReasonBadge reason={row.queueReason} />
            <AttemptBadge attemptNumber={row.attemptNumber} maxAttempts={maxAttempts} />
            <InfoTip label={ATTEMPTS_EXPLAINER} />
          </DialogTitle>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {dial ? (
              <a
                href={dial}
                className="inline-flex min-h-8 items-center gap-1.5 font-medium text-primary hover:underline"
              >
                <Phone size={13} />
                {row.phone}
              </a>
            ) : (
              <span className="text-amber-400">No phone number on this record</span>
            )}
            <span>
              {row.patientName}
              {row.bookingCount > 1
                ? ` · ${row.bookingCount} tests`
                : row.testType
                ? ` · ${row.testType}`
                : ""}
            </span>
          </div>
        </DialogHeader>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
          {/* The consent notice. Pinned, always, on every stage — the notes are
              health-adjacent personal data and this one line is what makes taking
              them legitimate. It is scripted here precisely so it can't be forgotten. */}
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2.5">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-sky-400">
              Say this first
              <InfoTip label="A one-line notice at the start of every call. We don't record audio — your typed notes are the record, and this is the consent that lets us take them. Keep the notes to service feedback: nothing about diagnoses or results." />
            </span>
            <p className="mt-1 text-sm leading-relaxed">{consentScript(adminName)}</p>
          </div>

          {/* Everything they told us last time. The caller must never re-ask a
              question this person has already answered. */}
          {row.previousCalls.length > 0 && (
            <PreviousCallsList calls={row.previousCalls} />
          )}

          {row.incident && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-red-400">
                We hurt this person
              </span>
              <p className="mt-1 text-sm leading-relaxed">
                {row.incident.ref ? (
                  <span className="font-mono text-xs font-semibold">{row.incident.ref} · </span>
                ) : null}
                {row.incident.title ?? "An incident is linked to this visit."}
              </p>
            </div>
          )}

          {/* ── STAGE 1 — the seven buttons. One tap, and a failed call is done. ── */}
          {stage === "disposition" && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">How did the call go?</span>
              <div className="grid gap-2 sm:grid-cols-2">
                {meta.dispositions.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    disabled={submitting}
                    onClick={() => handleDisposition(d.value)}
                    className={cn(
                      "flex min-h-16 flex-col items-start justify-center gap-0.5 rounded-xl border border-border bg-card px-3 py-2 text-left transition-colors",
                      "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                      DISPOSITION_TILE[d.value],
                      // The permanent one sits alone on its own row, away from the thumb.
                      d.value === "do_not_contact" && "sm:col-span-2"
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      {d.label}
                      {d.value === "do_not_contact" && <InfoTip label={DNC_EXPLAINER} />}
                    </span>
                    <span className="text-[11px] leading-tight text-muted-foreground">
                      {DISPOSITION_HINT[d.value] ?? ""}
                      {d.value === "callback" ? ` · ${CALLBACK_NOTE}` : ""}
                    </span>
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">
                Anything but {'"'}Connected{'"'} saves straight away — one tap and you{"'"}re back on the queue.
              </span>
              {submitting && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 size={12} className="animate-spin" />
                  Saving…
                </span>
              )}
            </div>
          )}

          {/* ── callback — the server requires a time, so we ask for one ─────────── */}
          {stage === "callback" && (
            <div className="flex flex-col gap-2">
              <label htmlFor="cb-when" className="flex items-center gap-1.5 text-sm font-medium">
                When should we ring back?
                <InfoTip label="A callback doesn't burn an attempt — they answered and asked for a better time, which is the opposite of not reaching them. Try a different time of day from the one that failed." />
              </label>
              <Input
                id="cb-when"
                type="datetime-local"
                value={callbackAt}
                onChange={(e) => onCallbackChange(e.target.value)}
                disabled={submitting}
                className="text-base sm:text-sm"
              />
              {callbackInPast && (
                <span className="text-xs text-amber-400">That time has already passed.</span>
              )}
            </div>
          )}

          {/* ── do_not_contact — permanent, so it is confirmed ───────────────────── */}
          {stage === "confirm-dnc" && (
            <div className="flex flex-col gap-3 rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-3">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-red-400">
                <AlertTriangle size={15} />
                This permanently removes them from every future call list
              </span>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {row.userName} will never appear in this queue again — not after their next test, not
                after an incident. It is a withdrawal of consent, not a preference, and it is not
                undoable from this screen.
              </p>
            </div>
          )}

          {/* ── STAGE 2 — connected. Four inputs on a good call. ─────────────────── */}
          {stage === "connected" && (
            <>
              {/* 1 — CSAT. Required. Read the script verbatim, every time: the same
                     words each call is the only thing that makes the number comparable. */}
              <div className="flex flex-col gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  CSAT
                  <InfoTip label={CSAT_EXPLAINER} />
                </span>
                <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm leading-relaxed">
                  {CSAT_SCRIPT}
                </p>
                <div className="grid grid-cols-5 gap-1.5">
                  {CSAT_VALUES.map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={csat === v}
                      aria-label={`${v} — ${CSAT_LABEL[v]}`}
                      disabled={submitting}
                      onClick={() => setCsat(v)}
                      className={cn(
                        "flex min-h-14 flex-col items-center justify-center rounded-xl border text-lg font-semibold tabular-nums transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                        csat === v
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-card text-muted-foreground hover:bg-accent"
                      )}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">
                  {csat === null ? "1 = very dissatisfied · 5 = very satisfied" : CSAT_LABEL[csat]}
                </span>
                <p className="text-xs italic text-muted-foreground">Then ask: “{FOLLOW_UP_SCRIPT}”</p>
              </div>

              {/* 2 — Tags. Chips, never a text box. */}
              <div className="flex flex-col gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  What came up?
                  <InfoTip label={TAGS_EXPLAINER} />
                </span>
                {meta.tags.length === 0 ? (
                  <span className="text-xs text-amber-400">
                    Couldn{"'"}t load the tag list from the server, so there{"'"}s nothing to tick. Write it in
                    the notes instead — the call still logs, and we{"'"}d rather have no tag than a made-up one
                    that never adds up.
                  </span>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {meta.tags.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        aria-pressed={tags.includes(t.value)}
                        disabled={submitting}
                        onClick={() => toggleTag(t.value)}
                        className={cn(
                          "min-h-9 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                          tags.includes(t.value)
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-border text-muted-foreground hover:bg-accent"
                        )}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                )}
                {metaDegraded && meta.tags.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    (The seven outcome buttons are built in, so logging still works.)
                  </span>
                )}
              </div>

              {/* 3 — Notes. Focused as soon as a score is in. */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="call-notes" className="flex items-center gap-1.5 text-sm font-medium">
                  Notes
                  <InfoTip label="Service feedback only — what happened, what annoyed them, what they'd want different. Never anything about diagnoses or results: these notes must not become a shadow clinical record." />
                </label>
                <textarea
                  id="call-notes"
                  ref={notesRef}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={submitting}
                  rows={6}
                  placeholder="What did they say?"
                  className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-base leading-relaxed transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm dark:bg-input/30"
                />
              </div>

              {/* 4 — Verbatim. One quote. Optional. */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="call-verbatim" className="flex items-center gap-1.5 text-sm font-medium">
                  <Quote size={13} className="text-muted-foreground" />
                  Best quote from this call
                  <InfoTip label="Optional — one line, in their words, not yours. A single real sentence from a customer moves a room in a way an average never does." />
                </label>
                <Input
                  id="call-verbatim"
                  value={verbatim}
                  onChange={(e) => setVerbatim(e.target.value)}
                  disabled={submitting}
                  placeholder="“I'd fasted since 6pm and nobody came.”"
                  className="text-base sm:text-sm"
                />
              </div>

              {/* 5 — Resolved. Only when there is something to resolve. */}
              {showResolved && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={resolved}
                  disabled={submitting}
                  onClick={() => setResolved((r) => !r)}
                  className={cn(
                    "flex min-h-12 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                    resolved
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-border bg-card hover:bg-accent"
                  )}
                >
                  <span className="flex flex-col">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      Is this sorted for them?
                      <InfoTip label="Their problem, not ours. Tick it only if the customer said they're whole again — not because we've filed something. The incident's own status is a separate question, on a separate screen." />
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {resolved ? "Yes — they said it's sorted." : "Not yet."}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors",
                      resolved ? "border-emerald-500 bg-emerald-500/30" : "border-border bg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "ml-0.5 h-4.5 w-4.5 rounded-full bg-foreground/70 transition-transform",
                        resolved && "translate-x-5"
                      )}
                    />
                  </span>
                </button>
              )}
            </>
          )}
        </div>

        {/* Pinned action bar — thumb-reachable at any scroll position. */}
        <DialogFooter className="mx-0 mb-0 flex-col gap-2 rounded-none border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          {stage === "disposition" ? (
            <>
              <span className="order-2 text-xs text-muted-foreground sm:order-1">
                {row.bookingCount > 1
                  ? `${row.bookingCount} bookings — one visit, one call.`
                  : "One tap logs a failed call."}
              </span>
              <Button
                variant="outline"
                disabled={submitting}
                onClick={() => onOpenChange(false)}
                className="order-1 h-11 sm:order-2 sm:h-9"
              >
                Close
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                disabled={submitting}
                onClick={() => setStage("disposition")}
                className="order-2 h-11 justify-start sm:order-1 sm:h-9"
              >
                <ArrowLeft size={14} className="mr-1.5" />
                Back
              </Button>

              {stage === "callback" && (
                <Button
                  disabled={submitting || callbackIso === null}
                  onClick={() => callbackIso && void submit("callback", { callbackAt: callbackIso })}
                  className="order-1 h-11 text-base sm:order-2 sm:h-9 sm:text-sm"
                >
                  {submitting ? (
                    <><Loader2 size={14} className="mr-2 animate-spin" />Saving…</>
                  ) : (
                    "Save callback"
                  )}
                </Button>
              )}

              {stage === "confirm-dnc" && (
                <Button
                  variant="destructive"
                  disabled={submitting}
                  onClick={() => void submit("do_not_contact")}
                  className="order-1 h-11 text-base sm:order-2 sm:h-9 sm:text-sm"
                >
                  {submitting ? (
                    <><Loader2 size={14} className="mr-2 animate-spin" />Saving…</>
                  ) : (
                    "Never call again"
                  )}
                </Button>
              )}

              {stage === "connected" && (
                <div className="order-1 flex flex-col items-stretch gap-1 sm:order-2 sm:items-end">
                  <Button
                    disabled={submitting || connectedBlocker !== null}
                    title={connectedBlocker ?? undefined}
                    onClick={() =>
                      csat !== null &&
                      void submit("connected", {
                        csat,
                        tags,
                        notes,
                        verbatim,
                        // Only ever sent when the toggle was actually shown AND turned on.
                        ...(showResolved && resolved ? { resolved: true } : {}),
                      })
                    }
                    className="h-11 text-base sm:h-9 sm:text-sm"
                  >
                    {submitting ? (
                      <><Loader2 size={14} className="mr-2 animate-spin" />Saving…</>
                    ) : (
                      "Save call"
                    )}
                  </Button>
                  {connectedBlocker && (
                    <span className="text-xs text-muted-foreground">{connectedBlocker}</span>
                  )}
                </div>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
