"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MessageSquare, Phone, Search, User, X, type LucideIcon } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { feedbackErrorMessage, listUsersForPicker, logFeedback } from "../api";
import {
  CHANNEL_EXPLAINER,
  CHANNEL_HINT,
  CHANNEL_LABEL,
  FEEDBACK_CHANNELS,
  type FeedbackChannel,
  type PickableUser,
} from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Fired with the customer's id after a dump is saved. The feed page uses it to
   * navigate straight to that customer's living-note view (where the note is now
   * organizing in the background).
   */
  onLogged: (userId: string) => void;
}

const CHANNEL_ICON: Record<FeedbackChannel, LucideIcon> = {
  in_person: User,
  call: Phone,
  text: MessageSquare,
};

/** Cap the picker's visible matches — a phone keyboard over 200 rows is unusable. */
const MAX_MATCHES = 8;

export function LogFeedbackDialog({ open, onOpenChange, onLogged }: Props) {
  // Customer picker.
  const [users, setUsers] = useState<PickableUser[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [customer, setCustomer] = useState<PickableUser | null>(null);

  const [channel, setChannel] = useState<FeedbackChannel | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Guards a second submit fired before the first response lands — double-tapping
  // a big button on a phone is easy, and a duplicate entry is a lie about how many
  // people said the same thing.
  const submittingRef = useRef(false);

  const notesRef = useRef<HTMLTextAreaElement>(null);

  // Move focus to the notes box the moment a customer is picked — that's the next
  // required field, and on a phone it saves a tap. The search input owns autofocus
  // while it's mounted, so this can't fight it (they never coexist).
  useEffect(() => {
    if (customer !== null) notesRef.current?.focus();
  }, [customer]);

  // Load the customer list once the dialog opens. GET /users already works today,
  // so unlike the feed this part is exercised even before the feedback backend
  // ships. Fetched fresh each open is fine at a few hundred users. The fetch is
  // deferred a tick so the loading flag isn't set synchronously in the effect body
  // (which cascades an extra render — same reason app/incidents defers its load).
  useEffect(() => {
    if (!open || users !== null) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setUsersLoading(true);
      listUsersForPicker()
        .then((u) => { if (!cancelled) { setUsers(u); setUsersError(null); } })
        .catch((e) => { if (!cancelled) setUsersError(feedbackErrorMessage(e)); })
        .finally(() => { if (!cancelled) setUsersLoading(false); });
    }, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, users]);

  const matches = useMemo(() => {
    if (!users) return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const digits = q.replace(/\D/g, "");
    return users
      .filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          (digits !== "" && u.whatsappPhone.replace(/\D/g, "").includes(digits))
      )
      .slice(0, MAX_MATCHES);
  }, [users, query]);

  const notesEmpty = notes.trim() === "";
  const blocker: string | null =
    customer === null
      ? "Pick a customer first."
      : channel === null
      ? "Choose how they told us."
      : notesEmpty
      ? "Type what they said."
      : null;

  async function submit() {
    if (submittingRef.current || customer === null || channel === null || notesEmpty) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await logFeedback({
        userId: customer.id,
        channel,
        notes,
      });
      const userId = customer.id;
      toast.success("Saved — organizing the note…");
      onOpenChange(false);
      // Hand the caller the customer so it can open their living note, where the
      // background organize will be picked up by polling.
      onLogged(userId);
    } catch (err) {
      // Stay open with the notes intact — a network blip must never cost the
      // operator what they just typed. Only the server's own message is shown.
      toast.error(feedbackErrorMessage(err));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitting) onOpenChange(o); }}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92dvh] w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle>Log feedback</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
          {/* 1 — Customer. Required. Search the existing user list by name/phone. */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Who gave the feedback?</span>
            {customer ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{customer.name || "Unnamed"}</span>
                  {customer.whatsappPhone && (
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {customer.whatsappPhone}
                    </span>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={submitting}
                  onClick={() => { setCustomer(null); setQuery(""); }}
                >
                  <X size={14} className="mr-1" />
                  Change
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    disabled={submitting || usersLoading}
                    placeholder={usersLoading ? "Loading customers…" : "Search by name or phone…"}
                    className="pl-8 text-base sm:text-sm"
                  />
                </div>

                {usersError ? (
                  <span className="text-xs text-destructive">{usersError}</span>
                ) : query.trim() !== "" && matches.length === 0 && !usersLoading ? (
                  <span className="text-xs text-muted-foreground">
                    No customer matches “{query.trim()}”.
                  </span>
                ) : matches.length > 0 ? (
                  <ul className="flex max-h-56 flex-col overflow-y-auto rounded-lg border border-border">
                    {matches.map((u) => (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() => { setCustomer(u); setQuery(""); }}
                          className="flex w-full flex-col items-start gap-0.5 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                        >
                          <span className="text-sm font-medium">{u.name || "Unnamed"}</span>
                          {u.whatsappPhone && (
                            <span className="font-mono text-xs text-muted-foreground">
                              {u.whatsappPhone}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </div>

          {/* 2 — Channel. Required. Three big tap targets. */}
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              How did they tell us?
              <InfoTip label={CHANNEL_EXPLAINER} />
            </span>
            <div className="grid grid-cols-3 gap-2">
              {FEEDBACK_CHANNELS.map((c) => {
                const Icon = CHANNEL_ICON[c];
                const active = channel === c;
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={active}
                    disabled={submitting}
                    onClick={() => setChannel(c)}
                    title={CHANNEL_HINT[c]}
                    className={cn(
                      "flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border text-center transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                      active
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-card text-muted-foreground hover:bg-accent"
                    )}
                  >
                    <Icon size={18} />
                    <span className="text-xs font-medium">{CHANNEL_LABEL[c]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3 — Notes. Required, non-empty. Focused when a customer is picked (the
                 search box owns autofocus before that — see the effect above). */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="feedback-notes" className="text-sm font-medium">
              What did they say?
            </label>
            <textarea
              id="feedback-notes"
              ref={notesRef}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={submitting}
              rows={6}
              placeholder="Their words, or your understanding of them…"
              className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-base leading-relaxed transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm dark:bg-input/30"
            />
          </div>
        </div>

        {/* Pinned action bar — thumb-reachable at any scroll position. */}
        <DialogFooter className="mx-0 mb-0 flex-col gap-2 rounded-none border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <Button
            variant="outline"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
            className="order-2 h-11 sm:order-1 sm:h-9"
          >
            Cancel
          </Button>
          <div className="order-1 flex flex-col items-stretch gap-1 sm:order-2 sm:items-end">
            <Button
              disabled={submitting || blocker !== null}
              title={blocker ?? undefined}
              onClick={() => void submit()}
              className="h-11 text-base sm:h-9 sm:text-sm"
            >
              {submitting ? (
                <><Loader2 size={14} className="mr-2 animate-spin" />Saving…</>
              ) : (
                "Save feedback"
              )}
            </Button>
            {blocker && <span className="text-xs text-muted-foreground">{blocker}</span>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
