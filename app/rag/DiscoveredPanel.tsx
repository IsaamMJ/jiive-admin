"use client";

import { Fragment, useRef, useState } from "react";
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
  countDiscovered,
  discoveredBand,
  isSourceDateUnknown,
  publisherDomain,
  runDiscovery,
  safeSourceUrl,
  sortDiscovered,
  type DiscoverOutcome,
} from "./discovery";
import type { DiscoveredDocument } from "./types";

/**
 * The Discovered tab: the record of what a machine put in the knowledge base.
 *
 * Every document here was fetched from the internet by a machine because a real
 * customer asked something the knowledge base could not answer. Approving one
 * publishes clinical content to a live health product, so a row that is still
 * awaiting a decision offers exactly one affordance: open it and read it.
 *
 * ⚠️ THIS IS NOT A LIST OF WORK. `GET /rag/discovered` has no status filter, so
 * an approved document stays here forever — see countDiscovered. Rows therefore
 * come in two kinds and MUST NOT be rendered alike:
 *   awaiting → amber pill, "Read & review", present tense ("the KB has no
 *       answer"), sorted to the top.
 *   approved → green "Live" pill, "View", past tense, sorted below a divider.
 * Handing an approved document a "Read & review" button is how ten finished
 * documents came to read as ten open tasks.
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
  /**
   * Auto-discovered rows recovered from `GET /rag/documents` itself, used ONLY
   * when this endpoint is unavailable or errored.
   *
   * ⚠️ WHY THIS PROP EXISTS. The main list now partitions on the row's own
   * `sourceUrl`/`discoveredVia`, which no longer depends on this endpoint
   * succeeding. That is the fix — but it means a discovered document is moved
   * OUT of the Documents tab even when this queue is down, and without a
   * fallback it would then be visible in neither tab. Silently disappearing a
   * document nobody has read is a worse failure than the one the split fixes.
   *
   * These rows carry no `sourceDate`, because `/rag/documents` doesn't return
   * one — so they render as "Publication date unknown", which is true of what
   * we know rather than of the document.
   */
  fallbackDocs?: DiscoveredDocument[];
}

export function DiscoveredPanel({
  docs,
  loading,
  error,
  unavailable,
  onReview,
  onRefresh,
  fallbackDocs = [],
}: Props) {
  /**
   * The rows actually on screen — the same choice the list body below makes, so
   * the header count can never describe a different population than the table.
   */
  const rows = (unavailable || error) && fallbackDocs.length > 0 ? fallbackDocs : docs;
  /**
   * ⚠️ Never `rows.length` for anything called "waiting". This endpoint has no
   * status filter and keeps approved documents forever — see countDiscovered.
   */
  const counts = countDiscovered(rows);

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
      {/* ── Why this queue exists ───────────────────────────────────────────
          ⚠️ "Nobody has read these" is a claim about the ROWS ON SCREEN, and
          this endpoint returns approved documents forever (see countDiscovered).
          On dev it stated that about three documents that were approved and live
          in the knowledge base. It is now conditional on there actually being
          something unread, and the already-approved case gets its own, true,
          and quieter sentence. */}
      {counts.awaiting > 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>
              <strong>
                Nobody has read {counts.awaiting === 1 ? "this one" : `these ${counts.awaiting}`}.
              </strong>{" "}
              A machine fetched {counts.awaiting === 1 ? "it" : "them"} from the internet because
              customers asked questions the knowledge base could not answer. Read each one before
              approving it — approving publishes it to customers.
            </span>
          </p>
        </div>
      ) : (
        !loading &&
        !error &&
        !unavailable &&
        rows.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <p className="text-xs leading-relaxed text-muted-foreground">
              <strong className="text-foreground">Nothing is waiting for review.</strong>{" "}
              {counts.approved > 0 && (
                <>
                  {counts.approved} of these {counts.approved === 1 ? "was" : "were"} approved and{" "}
                  {counts.approved === 1 ? "is" : "are"}{" "}
                  live in the knowledge base — you&apos;ll find{" "}
                  {counts.approved === 1 ? "it" : "them"} under{" "}
                  <strong className="text-foreground">Documents</strong> too.{" "}
                </>
              )}
              This tab is the record of what a machine put here, so approved documents stay in it.
            </p>
          </div>
        )
      )}

      {/* ── Header: count + manual run ────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          {/* The count is only stated when it is actually known. While loading or
              after a failure, "0 waiting" would be a claim we cannot make. */}
          {/* Only `awaiting` may be called "waiting for review". The row total
              is stated separately so the list length is still accounted for. */}
          {loading
            ? "Loading queue…"
            : error || unavailable
            ? "Queue unavailable"
            : `${counts.awaiting} waiting for review · ${rows.length} auto-discovered in total`}
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
      ) : (unavailable || error) && fallbackDocs.length > 0 ? (
        // The queue endpoint is down, but the documents list itself stamps
        // provenance — so these rows are still reachable. Say exactly where they
        // came from and what is missing from them; a silent fallback that looked
        // like the real queue would overstate what we know.
        <>
          <p className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>
              The discovered queue couldn&apos;t be loaded
              {error ? <> — {error}</> : " in this environment"}. These{" "}
              {fallbackDocs.length} row{fallbackDocs.length !== 1 ? "s were" : " was"} recovered from
              the documents list instead, so publication dates are missing here and the list may not
              be complete.
            </span>
          </p>
          <DiscoveredList docs={fallbackDocs} onReview={onReview} />
        </>
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
        <DiscoveredList docs={docs} onReview={onReview} />
      )}

      <DiscoverConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={handleDiscover}
      />
    </div>
  );
}

// ── The list ─────────────────────────────────────────────────────────────────

/**
 * The rows, work first.
 *
 * The endpoint returns newest-first and keeps approved rows forever, so without
 * this an unread document arrives wherever its timestamp lands — somewhere in a
 * column of documents that need nothing. `sortDiscovered` floats the three bands
 * (awaiting → not-ready → approved) and a divider names the boundary, so the
 * approved tail reads as an archive rather than as more of the same queue.
 *
 * The tail is never collapsed behind a "show more". It is the record of what a
 * machine put into a live clinical knowledge base; that has to stay in plain
 * sight, just not in the way.
 */
function DiscoveredList({
  docs,
  onReview,
}: {
  docs: DiscoveredDocument[];
  onReview: (documentId: string) => void;
}) {
  const sorted = sortDiscovered(docs);
  const firstApproved = sorted.findIndex((d) => discoveredBand(d.status) === 2);
  // Only when something sits above it — a list that is entirely approved needs
  // no boundary, and the panel's own header already says nothing is waiting.
  const dividerAt = firstApproved > 0 ? firstApproved : -1;

  return (
    <ul className="flex flex-col gap-2">
      {sorted.map((doc, i) => (
        <Fragment key={doc.documentId}>
          {i === dividerAt && (
            <li className="flex items-center gap-2 pt-2 text-[11px] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              <span className="shrink-0">Already approved — kept as a record</span>
              <span className="h-px flex-1 bg-border" />
            </li>
          )}
          <DiscoveredRow doc={doc} onReview={onReview} />
        </Fragment>
      ))}
    </ul>
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
  /**
   * Approved and live. The row still exists — this tab is the provenance record
   * — but it is finished, and every affordance and every tense on it says so.
   */
  const approved = doc.status === "ready";
  /** Still being parsed. There is nothing to read yet, so there is nothing to open. */
  const parsing = doc.status === "queued" || doc.status === "processing";

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
              //
              // ⚠️ TENSE FOLLOWS STATUS. "the knowledge base had no answer" is
              // present-perfect about a gap that is still open — which stops
              // being true the moment this document is approved, because
              // approving it is what closed the gap. An approved row saying the
              // KB has no answer for the very question it now answers is a
              // standing falsehood on ten rows out of ten.
              <span className="text-muted-foreground">
                {approved ? "Fetched because customers asked about" : "Customers asked about"}{" "}
                <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
                  {doc.discoveryQuery}
                </span>{" "}
                {approved
                  ? "— a gap this document was approved to fill"
                  : "and the knowledge base had no answer"}{" "}
                <InfoTip
                  label={
                    approved
                      ? "The backend logs every question it fails to answer. This document was fetched for that gap and is now live, so the same question should retrieve it."
                      : "The backend logs every question it fails to answer. When one keeps coming up, it goes looking for a document that covers it. That question is what you're reviewing this document against."
                  }
                />
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

        {/* One document, one decision. No checkbox, by design.

            The LABEL is the decision state, not a constant. "Read & review" on a
            document that is already live is an instruction to do something that
            is done — and with the endpoint keeping approved rows forever, that
            was every row on the screen. An approved row gets a quiet "View": the
            content is still one click away, it just isn't asking. */}
        <div className="shrink-0">
          <Button
            size="sm"
            variant={approved || parsing ? "ghost" : "outline"}
            className="w-full sm:w-auto"
            disabled={parsing}
            title={parsing ? "Still being parsed — there's nothing to read yet." : undefined}
            onClick={() => onReview(doc.documentId)}
          >
            {parsing ? (
              <>
                <Loader2 size={14} className="mr-1.5 animate-spin" />
                Parsing…
              </>
            ) : (
              <>
                <Eye size={14} className="mr-1.5" />
                {approved ? "View" : "Read & review"}
              </>
            )}
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
