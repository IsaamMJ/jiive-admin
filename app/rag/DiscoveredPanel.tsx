"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarOff,
  ExternalLink,
  Eye,
  Loader2,
  RefreshCw,
  Search,
  SearchX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InfoTip } from "@/components/InfoTip";
import { StatusBadge } from "./StatusBadge";
import {
  isSourceDateUnknown,
  publisherDomain,
  runDiscovery,
  safeSourceUrl,
  type DiscoverOutcome,
} from "./discovery";
import type { DiscoveredDocument } from "./types";

/**
 * The Discovered review queue.
 *
 * Every document here was fetched from the internet by a machine because a real
 * customer asked something the knowledge base could not answer. **Nobody has
 * read any of it.** Approving one publishes clinical content to a live health
 * product, so this panel deliberately offers exactly one affordance per row:
 * open it and read it.
 *
 * ⚠️ DO NOT ADD select-all, multi-select, or an approve-all here. From the
 * backend handoff: *"it is the one place in the product where reading before
 * approving is the whole point."* The approve action itself is not in this file
 * at all — rows hand off to the existing review dialog on the page, which is the
 * only approve path in the module.
 *
 * Provenance (publisher, why we went looking, publication date) is rendered in
 * the row rather than behind a click: a reviewer needs to know who published
 * something and why it was fetched *before* deciding to open it. A title alone
 * cannot support that call.
 */

interface Props {
  docs: DiscoveredDocument[];
  loading: boolean;
  /** Verbatim server message, or null. Distinct from `unavailable`. */
  error: string | null;
  /** 404 — this deployment predates the discovered queue. Not an outage. */
  unavailable: boolean;
  onReview: (documentId: string) => void;
  /** Re-fetch the queue (also called after a manual discovery run). */
  onRefresh: () => void;
}

export function DiscoveredPanel({ docs, loading, error, unavailable, onReview, onRefresh }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const discoveringRef = useRef(false);
  const [lastRun, setLastRun] = useState<DiscoverOutcome | null>(null);

  async function handleDiscover() {
    if (discoveringRef.current) return; // double-submit guard — each run costs a real search call
    discoveringRef.current = true;
    setDiscovering(true);
    setConfirmOpen(false);
    // runDiscovery never throws and carries its own 90s timeout, so this spinner
    // is always reachable by an ending — it cannot get stuck.
    const outcome = await runDiscovery();
    setLastRun(outcome);
    discoveringRef.current = false;
    setDiscovering(false);
    if (outcome.kind === "ran") {
      toast.success(
        outcome.result.queued > 0
          ? `${outcome.result.queued} document${outcome.result.queued !== 1 ? "s" : ""} queued for review.`
          : "Search finished — nothing new was queued."
      );
      onRefresh();
    } else if (outcome.kind === "unavailable") {
      // A capability answer, not a failure. Toasting this red would train the
      // operator to treat a correct response as a broken button.
      toast.info(outcome.message);
    } else {
      toast.error(outcome.message);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ── Why this queue exists ─────────────────────────────────────────── */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            <strong>Nobody has read these.</strong>{" "}
            A machine fetched them from the internet because customers asked questions the knowledge
            base could not answer. Read each one before approving it — approving publishes it to
            customers.
          </span>
        </p>
      </div>

      {/* ── Header: count + manual run ────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          {/* The count is only stated when it is actually known. While loading or
              after a failure, "0 waiting" would be a claim we cannot make. */}
          {loading
            ? "Loading queue…"
            : error || unavailable
            ? "Queue unavailable"
            : `${docs.length} waiting for review`}
          <InfoTip label="Documents the backend found on its own, for questions customers asked that the knowledge base had no answer for. They are inert until you approve them one at a time." />
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading || discovering}>
            <RefreshCw size={13} className={`mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={discovering || lastRun?.kind === "unavailable"}
            title={
              lastRun?.kind === "unavailable"
                ? "Automatic discovery isn't switched on in this environment."
                : undefined
            }
          >
            {discovering ? (
              <>
                <Loader2 size={13} className="mr-1.5 animate-spin" />
                Searching…
              </>
            ) : (
              <>
                <Search size={13} className="mr-1.5" />
                Find documents now
              </>
            )}
          </Button>
          <InfoTip
            side="left"
            label="Runs the search immediately instead of waiting for the weekly job. It looks only at gaps customers actually hit, checks a fixed list of medical publishers, and can queue at most 5 documents. Takes about 30 seconds."
          />
        </div>
      </div>

      {discovering && (
        <p className="text-xs text-muted-foreground">
          Searching the allowlisted publishers — this takes about 30 seconds. Anything found lands
          here as pending review; nothing is published.
        </p>
      )}

      {/* ── Result of the last manual run ─────────────────────────────────── */}
      {lastRun && !discovering && <DiscoverRunSummary outcome={lastRun} />}

      {/* ── The queue ─────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : unavailable ? (
        // 404 — deliberately worded as a missing capability, not an outage, so an
        // older backend doesn't look like a broken one.
        <EmptyState
          icon={<SearchX size={18} />}
          title="Automatic discovery isn't available in this environment"
          body="This backend doesn't have the discovered-documents endpoint yet. Nothing is wrong — the knowledge base still works, it just isn't finding candidates on its own here."
        />
      ) : error ? (
        <EmptyState
          tone="error"
          icon={<AlertTriangle size={18} />}
          title="Couldn't load the discovered queue"
          // Verbatim server message — never a paraphrase.
          body={error}
          action={
            <Button variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCw size={13} className="mr-1.5" />
              Try again
            </Button>
          }
        />
      ) : docs.length === 0 ? (
        // ⚠️ An empty queue is NOT "the knowledge base has no gaps". On prod it is
        // empty because the miss log only started recording with this deploy, and
        // a gap must recur twice in 7 days before anything is fetched. Wording
        // that let emptiness read as coverage would be exactly the failure this
        // whole feature exists to fix.
        <EmptyState
          icon={<SearchX size={18} />}
          title="Nothing found yet"
          body="This fills up as customers ask things the knowledge base can't answer. A question has to come up at least twice in a week before the backend goes looking, and it checks weekly. An empty queue means nothing has been fetched yet — not that the knowledge base is complete."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {docs.map((doc) => (
            <DiscoveredRow key={doc.documentId} doc={doc} onReview={onReview} />
          ))}
        </ul>
      )}

      <DiscoverConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={handleDiscover}
      />
    </div>
  );
}

// ── One document ─────────────────────────────────────────────────────────────

function DiscoveredRow({
  doc,
  onReview,
}: {
  doc: DiscoveredDocument;
  onReview: (documentId: string) => void;
}) {
  const domain = publisherDomain(doc.sourceUrl);
  const href = safeSourceUrl(doc.sourceUrl);
  const dateUnknown = isSourceDateUnknown(doc.sourceDate);

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          {/* Publisher domain first — it is the trust signal a reviewer weighs
              before the title. The full URL is noise by comparison. */}
          <div className="flex flex-wrap items-center gap-2">
            {domain ? (
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground">
                {domain}
              </span>
            ) : (
              // Unparseable or non-http(s): we cannot name a publisher and we will
              // not link it. Saying so is the honest render.
              <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                <AlertTriangle size={10} />
                Publisher unreadable
              </span>
            )}
            <StatusBadge status={doc.status} />
            {doc.status === "ready" && (
              <span className="text-[11px] text-muted-foreground">{doc.chunkCount} chunks</span>
            )}
          </div>

          <p className="text-sm font-medium break-words">{doc.title}</p>

          {/* Full URL, one line, its own row so long URLs never push the layout. */}
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-full items-center gap-1 text-xs text-primary underline underline-offset-2 hover:no-underline"
            >
              <span className="truncate">{doc.sourceUrl}</span>
              <ExternalLink size={11} className="shrink-0" />
            </a>
          ) : (
            <span className="max-w-full truncate text-xs text-muted-foreground" title={doc.sourceUrl}>
              {doc.sourceUrl}
            </span>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
            {/* WHY this document is here. Framed as the customer's unanswered
                question, because that is what it is — not a search keyword. */}
            {doc.discoveryQuery ? (
              // Plain inline flow, not flex: at 375px a flex row breaks this
              // sentence into ragged columns instead of wrapping as a sentence.
              <span className="text-muted-foreground">
                Customers asked about{" "}
                <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
                  {doc.discoveryQuery}
                </span>{" "}
                and the knowledge base had no answer{" "}
                <InfoTip label="The backend logs every question it fails to answer. When one keeps coming up, it goes looking for a document that covers it. That question is what you're reviewing this document against." />
              </span>
            ) : (
              <span className="text-muted-foreground">
                No record of which question triggered this fetch
              </span>
            )}

            {/* Publication date. NEVER parsed or formatted — see types.ts. */}
            {dateUnknown ? (
              <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-700 dark:text-amber-400">
                <CalendarOff size={10} />
                Publication date unknown
                <InfoTip label="The publisher didn't state when this was written, and the backend never guesses one. Clinical guidance goes out of date — check inside the document for a revision date before approving." />
              </span>
            ) : (
              <span className="text-muted-foreground">
                Published <span className="font-medium text-foreground">{doc.sourceDate}</span>
              </span>
            )}
          </div>
        </div>

        {/* One document, one decision. No checkbox, by design. */}
        <div className="shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => onReview(doc.documentId)}
          >
            <Eye size={14} className="mr-1.5" />
            Read &amp; review
          </Button>
        </div>
      </div>
    </li>
  );
}

// ── Manual-run result ────────────────────────────────────────────────────────

function DiscoverRunSummary({ outcome }: { outcome: DiscoverOutcome }) {
  if (outcome.kind === "unavailable") {
    return (
      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        {outcome.message}
      </p>
    );
  }
  if (outcome.kind === "error") {
    return (
      <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400">
        {outcome.message}
      </p>
    );
  }
  const { gaps, fetched, queued, skippedDuplicate, note } = outcome.result;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
      <p className="text-foreground">
        Searched <span className="font-medium">{gaps.length}</span> gap
        {gaps.length !== 1 ? "s" : ""} · fetched <span className="font-medium">{fetched}</span> ·
        queued <span className="font-medium">{queued}</span> · skipped{" "}
        <span className="font-medium">{skippedDuplicate}</span> already in the knowledge base
      </p>
      {gaps.length > 0 && (
        <p className="text-muted-foreground">Gaps chased: {gaps.join(", ")}</p>
      )}
      {/* A run that queued nothing means nothing was FOUND, or no gap had recurred
          often enough yet. It does not mean the knowledge base is complete. */}
      {gaps.length === 0 && (
        <p className="text-muted-foreground">
          No question has come up often enough yet to chase — a gap has to recur at least twice in
          seven days. That isn&apos;t a statement about how complete the knowledge base is.
        </p>
      )}
      {note && <p className="text-muted-foreground">{note}</p>}
    </div>
  );
}

// ── Shared empty/error frame ─────────────────────────────────────────────────

function EmptyState({
  icon,
  title,
  body,
  action,
  tone = "calm",
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
  tone?: "calm" | "error";
}) {
  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center ${
        tone === "error" ? "border-red-500/40 bg-red-500/5" : "border-border"
      }`}
    >
      <span className={tone === "error" ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}>
        {icon}
      </span>
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

// ── Confirm dialog for the manual run ────────────────────────────────────────
//
// Split out so the panel's own markup stays readable. A manual run spends a real
// search-API call and writes rows, so it says what it will do before it does it
// (BUILD-CHECKLIST #6).

function DiscoverConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Search for missing documents now?</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            This runs a live search against a fixed list of medical publishers (NICE, WHO, ICMR,
            PubMed Central and peers) for the questions customers have asked that the knowledge base
            could not answer.
          </p>
          <p>
            It takes about 30 seconds and can queue at most 5 documents.{" "}
            <strong className="text-foreground">Nothing is published</strong>{" "}
            — anything found lands here as pending review and still needs you to read and approve it.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={onConfirm}>Run search</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
