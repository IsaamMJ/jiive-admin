"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import { Hammer, MessageSquarePlus, Plus } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatDateTime } from "@/app/incidents/lib/datetime";
import { feedbackErrorMessage, isNotBuiltYet, listFeedback } from "./api";
import {
  CHANNEL_EMOJI,
  CHANNEL_LABEL,
  FEEDBACK_CHANNELS,
  humanizeEnumValue,
  type FeedbackChannel,
  type FeedbackEntry,
  type FeedbackListParams,
} from "./types";
import { useFeedbackMeta } from "./lib/useFeedbackMeta";
import { FeedbackTagStrip } from "./components/FeedbackTagStrip";
import { LogFeedbackDialog } from "./components/LogFeedbackDialog";
import { ExportMenu } from "./components/ExportMenu";

const PAGE_SIZE = 50;

export default function FeedbackPage() {
  const { meta } = useFeedbackMeta();

  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A 404 means the backend isn't built yet (shipping in parallel) — shown as a
  // calm building-in-progress panel, not a red outage box.
  const [notBuilt, setNotBuilt] = useState(false);

  const [channel, setChannel] = useState<FeedbackChannel | "all">("all");
  const [tag, setTag] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);

  const [logOpen, setLogOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const params: FeedbackListParams = { limit: PAGE_SIZE, offset };
    if (channel !== "all") params.channel = channel;
    if (tag !== "all") params.tag = tag;
    // Dates are sent as-is (YYYY-MM-DD); the backend filters createdAt.
    if (from) params.from = from;
    if (to) params.to = to;

    listFeedback(params)
      .then((r) => {
        setFeedback(r.feedback);
        setTotal(r.total);
        setError(null);
        setNotBuilt(false);
      })
      .catch((err: unknown) => {
        setFeedback([]);
        setTotal(0);
        setNotBuilt(isNotBuiltYet(err));
        setError(feedbackErrorMessage(err));
      })
      .finally(() => setLoading(false));
  }, [offset, channel, tag, from, to]);

  // Debounced like app/incidents — setting loading during the synchronous effect
  // pass otherwise cascades an extra render on every filter keystroke.
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.floor(offset / PAGE_SIZE);

  function resetPaging<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setOffset(0); };
  }

  return (
    <AdminLayout title="Feedback">
      <div className="flex flex-col gap-5 pb-24 sm:pb-8">
        {/* Header — export + log, plus the derived tag strip below. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-sm text-muted-foreground">
            Everything customers tell us — in person, on a call, or over text. Logged in their words,
            read when there&apos;s time, and exported for theme analysis.
          </p>
          <div className="flex items-center gap-2">
            <ExportMenu />
            <Button className="hidden sm:inline-flex" onClick={() => setLogOpen(true)}>
              <Plus size={14} className="mr-1.5" />
              Log feedback
            </Button>
          </div>
        </div>

        <FeedbackTagStrip feedback={feedback} />

        {/* Filters — kept light. */}
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={channel}
            onValueChange={(v) => resetPaging(setChannel)((v as FeedbackChannel) ?? "all")}
          >
            <SelectTrigger className="w-40">
              <SelectValue>
                {(v: unknown) =>
                  v === "all" ? "All channels" : CHANNEL_LABEL[v as FeedbackChannel] ?? String(v)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              {FEEDBACK_CHANNELS.map((c) => (
                <SelectItem key={c} value={c}>
                  {CHANNEL_EMOJI[c]} {CHANNEL_LABEL[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={tag} onValueChange={(v) => resetPaging(setTag)(v ?? "all")}>
            <SelectTrigger className="w-48">
              <SelectValue>
                {(v: unknown) =>
                  v === "all"
                    ? "All tags"
                    : (meta.tags.find((t) => t.value === v)?.label ?? humanizeEnumValue(String(v)))
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tags</SelectItem>
              {meta.tags.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              aria-label="From"
              value={from}
              onChange={(e) => resetPaging(setFrom)(e.target.value)}
              className="w-40"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              aria-label="To"
              value={to}
              onChange={(e) => resetPaging(setTo)(e.target.value)}
              className="w-40"
            />
          </div>

          <span className="text-sm text-muted-foreground">
            {loading ? "…" : notBuilt || error ? "" : `${total} entr${total !== 1 ? "ies" : "y"}`}
          </span>
        </div>

        {/* Feed */}
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
          </div>
        ) : notBuilt ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card/60 px-6 py-10 text-center">
            <Hammer size={22} className="text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">The feedback API isn&apos;t available yet</span>
              <span className="max-w-md text-sm text-muted-foreground">
                The backend is being built in parallel. This page — the feed, filters, and export —
                will light up the moment it ships. Logging a piece of feedback below will start
                working then too.
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={load}>Retry</Button>
          </div>
        ) : error ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-destructive">Couldn&apos;t load feedback</span>
              <span className="text-sm text-muted-foreground">{error}</span>
            </div>
            <Button variant="outline" size="sm" onClick={load}>Retry</Button>
          </div>
        ) : feedback.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card/60 px-6 py-10 text-center">
            <MessageSquarePlus size={22} className="text-muted-foreground" />
            <span className="text-sm font-medium">No feedback logged yet.</span>
            <span className="max-w-md text-xs text-muted-foreground">
              When a customer tells us something — good or bad — log it here in their words.
            </span>
            <Button variant="outline" size="sm" onClick={() => setLogOpen(true)}>
              <Plus size={14} className="mr-1.5" />
              Log the first one
            </Button>
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-2.5">
              {feedback.map((entry) => (
                <li key={entry.id} className="rounded-xl border border-border bg-card/60 p-3.5 sm:p-4">
                  <div className="flex items-start gap-3">
                    <span
                      className="mt-0.5 text-lg leading-none"
                      aria-label={CHANNEL_LABEL[entry.channel]}
                      title={CHANNEL_LABEL[entry.channel]}
                    >
                      {CHANNEL_EMOJI[entry.channel] ?? "💬"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                        <span className="font-medium">{entry.userName || "Unknown customer"}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(entry.createdAt)}
                        </span>
                        {entry.loggedByLabel && (
                          <span className="text-xs text-muted-foreground">
                            · by {entry.loggedByLabel}
                          </span>
                        )}
                      </div>

                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{entry.notes}</p>

                      {entry.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {entry.tags.map((t) => (
                            <span
                              key={t}
                              className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
                            >
                              {meta.tags.find((m) => m.value === t)?.label ?? humanizeEnumValue(t)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Thumb-reachable on a phone — logging must never require scrolling up. */}
      <Button
        onClick={() => setLogOpen(true)}
        className="fixed bottom-5 right-5 z-40 h-14 rounded-full px-5 shadow-lg sm:hidden"
      >
        <Plus size={18} className="mr-1.5" />
        Log feedback
      </Button>

      <LogFeedbackDialog open={logOpen} onOpenChange={setLogOpen} onLogged={load} />
    </AdminLayout>
  );
}
