"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Hammer, MessageSquarePlus, Plus, RotateCw, Search } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatDateTime } from "@/app/incidents/lib/datetime";
import {
  feedbackErrorMessage,
  isNotBuiltYet,
  listFeedbackCustomers,
  organizeCustomerNote,
} from "./api";
import {
  CHANNEL_EMOJI,
  CHANNEL_LABEL,
  FEEDBACK_CHANNELS,
  type CustomerFeedParams,
  type FeedbackChannel,
  type FeedbackCustomer,
} from "./types";
import { LogFeedbackDialog } from "./components/LogFeedbackDialog";
import { ExportMenu } from "./components/ExportMenu";

const PAGE_SIZE = 50;

export default function FeedbackPage() {
  const router = useRouter();

  const [customers, setCustomers] = useState<FeedbackCustomer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A 404 means the backend isn't built yet (shipping in parallel) — shown as a
  // calm building-in-progress panel, not a red outage box.
  const [notBuilt, setNotBuilt] = useState(false);

  const [channel, setChannel] = useState<FeedbackChannel | "all">("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);

  const [logOpen, setLogOpen] = useState(false);
  // Which row's "retry organize" is in flight — keyed by userId so only that row
  // shows a spinner.
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params: CustomerFeedParams = { limit: PAGE_SIZE, offset };
    if (channel !== "all") params.channel = channel;
    if (search.trim()) params.search = search.trim();
    // Dates are sent as-is (YYYY-MM-DD); the backend filters on activity date.
    if (from) params.from = from;
    if (to) params.to = to;

    listFeedbackCustomers(params)
      .then((r) => {
        setCustomers(r.customers);
        setTotal(r.total);
        setError(null);
        setNotBuilt(false);
      })
      .catch((err: unknown) => {
        setCustomers([]);
        setTotal(0);
        setNotBuilt(isNotBuiltYet(err));
        setError(feedbackErrorMessage(err));
      })
      .finally(() => setLoading(false));
  }, [offset, channel, search, from, to]);

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

  function openCustomer(userId: string) {
    router.push(`/feedback/${userId}`);
  }

  // A row whose organize failed can be retried inline without opening the note.
  async function retryOrganize(userId: string) {
    if (retrying) return;
    setRetrying(userId);
    try {
      const r = await organizeCustomerNote(userId);
      setCustomers((prev) =>
        prev.map((c) =>
          c.userId === userId
            ? { ...c, organizeStatus: r.organizeStatus, organizedPreview: r.organizedText || c.organizedPreview }
            : c
        )
      );
      toast.success(r.organizeStatus === "failed" ? "Still couldn't organize" : "Re-organizing…");
    } catch (err) {
      toast.error(feedbackErrorMessage(err));
    } finally {
      setRetrying(null);
    }
  }

  return (
    <AdminLayout title="Feedback">
      <div className="flex flex-col gap-5 pb-24 sm:pb-8">
        {/* Header — export + log. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-sm text-muted-foreground">
            One living note per customer. Dump what they tell you — in person, on a call, or over
            text — and an AI keeps each customer&apos;s note tidy. Your raw words are always kept
            underneath.
          </p>
          <div className="flex items-center gap-2">
            <ExportMenu />
            <Button className="hidden sm:inline-flex" onClick={() => setLogOpen(true)}>
              <Plus size={14} className="mr-1.5" />
              Log feedback
            </Button>
          </div>
        </div>

        {/* Filters — kept light. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="Search customers"
              value={search}
              onChange={(e) => resetPaging(setSearch)(e.target.value)}
              placeholder="Search name or phone…"
              className="w-56 pl-8"
            />
          </div>

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
            {loading ? "…" : notBuilt || error ? "" : `${total} customer${total !== 1 ? "s" : ""}`}
          </span>
        </div>

        {/* Feed of customers */}
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : notBuilt ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card/60 px-6 py-10 text-center">
            <Hammer size={22} className="text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">The feedback API isn&apos;t available yet</span>
              <span className="max-w-md text-sm text-muted-foreground">
                The backend is being built in parallel. This page — the feed, the living notes, and
                export — will light up the moment it ships. Logging a piece of feedback below will
                start working then too.
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
        ) : customers.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card/60 px-6 py-10 text-center">
            <MessageSquarePlus size={22} className="text-muted-foreground" />
            <span className="text-sm font-medium">No feedback yet.</span>
            <span className="max-w-md text-xs text-muted-foreground">
              When a customer tells us something — good or bad — log it against them and it becomes
              their living note.
            </span>
            <Button variant="outline" size="sm" onClick={() => setLogOpen(true)}>
              <Plus size={14} className="mr-1.5" />
              Log the first one
            </Button>
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-2.5">
              {customers.map((c) => (
                <li key={c.userId}>
                  {/* A div (not a button) so the failed-state retry can be a real
                      nested button without invalid interactive-in-interactive DOM.
                      Keyboard access is wired explicitly via role + tabIndex + keydown. */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => openCustomer(c.userId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openCustomer(c.userId);
                      }
                    }}
                    className="flex w-full cursor-pointer flex-col gap-1.5 rounded-xl border border-border bg-card/60 p-3.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-4"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                      <span className="font-medium">{c.userName || "Unknown customer"}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(c.lastDumpAt)}
                      </span>
                      <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                        {c.dumpCount} dump{c.dumpCount !== 1 ? "s" : ""}
                      </span>
                    </div>

                    {c.organizeStatus === "pending" ? (
                      <span className="text-sm italic text-muted-foreground">
                        {c.organizedPreview || "Organizing the note…"}
                      </span>
                    ) : (
                      <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                        {c.organizedPreview || "No summary yet — open to read the dumps."}
                      </p>
                    )}

                    {c.organizeStatus === "failed" && (
                      <button
                        type="button"
                        disabled={retrying === c.userId}
                        onClick={(e) => { e.stopPropagation(); void retryOrganize(c.userId); }}
                        className="inline-flex w-fit items-center gap-1 rounded text-xs text-amber-500 hover:text-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                      >
                        <RotateCw
                          size={12}
                          className={retrying === c.userId ? "animate-spin" : undefined}
                        />
                        {retrying === c.userId ? "Retrying…" : "Couldn't organize — tap to retry"}
                      </button>
                    )}
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

      <LogFeedbackDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        onLogged={(userId) => openCustomer(userId)}
      />
    </AdminLayout>
  );
}
