"use client";

/**
 * "What approving this document will throw away."
 *
 * ── WHY THIS IS CONTENT AND NOT A NOTIFICATION ──────────────────────────────
 *
 * `137 words dropped` is not information. Those 137 words are either a page
 * footer or a reference-range table, and ONLY READING THEM TELLS YOU WHICH —
 * the payload has no reason field, so the text is the only signal that exists.
 * The backend shipped `text`, not just a count; it had already decided the
 * content is the message.
 *
 * ── WHAT THIS BLOCK IS *NOT* ────────────────────────────────────────────────
 *
 * It is NOT the whole loss. `dropped` provably contains only short prose
 * fragments — table blocks are deleted from the document before chunking even
 * begins and never appear here (proof in `countStrippedTableBlocks`). That is
 * the bigger loss and it now has its own block, `StrippedTablesBlock`, rendered
 * beside this one. The copy in here must never imply this list covers tables;
 * a previous revision did, and it was the single most dangerous string on the
 * screen because it let an operator rule tables OUT by reading a list that
 * could never contain one.
 *
 * So the passages render VERBATIM (bar a 200-char server cut, which is flagged
 * on the row when it happens), monospace, `whitespace-pre-wrap`
 * — deliberately unlike ConvertPanel.tsx:292, which uses `truncate`. That is
 * acceptable for a preview which persists nothing and wrong for the irreversible
 * commit. The layout is itself the evidence: a dropped reference-range table
 * LOOKS like a table when you show it and looks like nothing when you summarise
 * it. A modal carrying a count literally cannot carry the signal that matters
 * most.
 *
 * ── WHY THE GATE IS A CHECKBOX, AND WHY IT IS EXPANSION-GATED ───────────────
 *
 * Live base rate 2026-08-10: 3 of 7 dev documents and 2 of 4 prod documents
 * drop something, and most of what they drop is navigational junk ("Bookshelf
 * home", "Published: April 2025."). A ceremony that costs the same for a page
 * footer and a dosing table is a ceremony that becomes muscle memory in a week.
 *
 * A scroll/intersection gate was the alternative and is worse: it is defeated
 * by one flick, it needs a keyboard fallback that collapses it back to a single
 * click anyway, and it is INVISIBLE — the operator cannot see why Approve is
 * dead, which breaks BUILD-CHECKLIST #4 ("disabled submit always shows why").
 *
 * So: a checkbox, which states its claim in words and is accessible for free —
 * but it is itself disabled until every passage has been expanded. The click
 * cost therefore scales with the size of the loss: one document with one junk
 * fragment is one click, the 30-passage NICE guideline is an expand plus a real
 * scroll. That is the correct cost curve, delivered through a legible mechanism.
 *
 * ── AND WHY THERE IS AN EXIT THAT ACTUALLY REPAIRS THE LOSS ─────────────────
 *
 * A gate whose only exit is a checkbox IS a click-through. "Copy all passages"
 * plus a pointer at the Paste text card on the page behind gives the operator a
 * second exit that puts the content back, using a card that already exists.
 *
 * ── DELIBERATELY NOT DONE ───────────────────────────────────────────────────
 *
 * • No per-fragment reason badge. Two causes exist, the payload distinguishes
 *   neither, and `words` correlates with the size floor without being it.
 * • No "this is a table" heuristic. Pipes are not guaranteed and a bulleted list
 *   of ranges has none; whitespace-aligned tables the parser already flattened
 *   would be missed entirely. Worse, once three fragments carry a TABLE badge
 *   the unbadged fourth reads as safe prose — an absent badge becoming a
 *   positive assurance, which is this repo's governing bug in a new costume, on
 *   the single highest-value loss.
 * • No page number. `tables[]` carries `page`; `dropped[]` does not. Borrowing
 *   one would be fabrication, and the header already renders `pageCount: null`
 *   honestly.
 * • No "% of the document" figure. That needs a denominator, and `parsedText`'s
 *   word count is not provably the chunker's input. Only the backend's own
 *   summed `words` is shown, and only when every fragment carried one.
 * • No sort control. The returned order is the only ordering the backend
 *   asserted, and it is likely document order — the one thing that helps an
 *   operator find the passage in the prose above. Re-ranking by word count would
 *   assert an importance we cannot justify.
 * • No nested scroll container. A `max-h` + `overflow-y` list on a phone hides
 *   content behind an invisible boundary, which is the exact failure mode this
 *   feature exists to prevent. Progressive disclosure by count instead.
 */

import { useState } from "react";
import { AlertTriangle, ChevronDown, Copy, Check, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/InfoTip";
import { cn } from "@/lib/utils";
import {
  CLEAR_INFOTIP,
  DROPPED_COUNT_INFOTIP,
  DROPPED_INFOTIP,
  DROPPED_MECHANISM,
  PASTE_BACK_NOTE,
  STRIPPED_TABLES_INFOTIP,
  STRIPPED_TABLES_WARNING,
  TABLES_CROSSREF_INFOTIP,
  numeralCount,
  type DropVerdict,
} from "./chunkPreview";
import { PROBE_INFOTIP, probeRetrieval, type ProbeOutcome } from "./search";
import type { DroppedFragment } from "./types";

export const DROPPED_BLOCK_ID = "rag-dropped-block";

/** How many passages render before the expander. Small enough that the button is on screen. */
const INITIAL_VISIBLE = 5;
/**
 * Below this, a passage is too short to make a meaningful retrieval query
 * ("Bookshelf home" would return noise and the noise would look like a finding),
 * so the probe button is not offered on it.
 *
 * Measured on the TEXT, not on `words`. `words` is nullable by contract, and
 * gating on it meant a fragment whose word count the server omitted lost its
 * probe silently — the one fragment we know least about getting the least
 * scrutiny.
 */
const MIN_PROBE_WORDS = 8;
/**
 * `MIN_PASTE_WORDS` in page.tsx. Duplicated deliberately rather than imported:
 * page.tsx imports this module, so importing back would be a cycle. If the two
 * drift, the toast under-warns — hence the assertion in the paste card.
 */
const PASTE_MIN_WORDS = 50;

/** Words in a string, counted the way both the backend and the paste gate count. */
function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/* NOTE: the old `CLAMP_WORDS = 60` clamp is gone, not disabled. It was dead
   code — a dropped fragment is under 25 words by construction and the server
   caps its text at 200 chars, so `words > 60` was never true and "Show all N
   words" could not render. Deleted rather than left to look like a safety net. */

interface Props {
  verdict: DropVerdict;
  /** From `ReviewResponse.tables` — used only for the cross-reference note. */
  tableCount: number;
  /** Lifted: the approve gate reads it. */
  ack: boolean;
  onAck: (v: boolean) => void;
  /** Lifted: the checkbox cannot arm until the full list has been expanded. */
  expanded: boolean;
  onExpand: () => void;
  disabled?: boolean;
}

export function DroppedContent({ verdict, tableCount, ack, onAck, expanded, onExpand, disabled }: Props) {
  // `unmeasured` and `preview_failed` say nothing ABOUT this document — they are
  // gaps in what we know — so their message goes in the merged NotCheckedPanel
  // above, with the other check that didn't run. One amber block instead of a
  // wall of them. The footer status line still speaks in every state, so the
  // slot is never silent.
  //
  // But the stripped-table count is NOT part of what the preview measured: it is
  // read off `parsedText` here in the client. It survives a missing, broken or
  // failed preview, and it is exactly the document a weak backend is most likely
  // to be serving — so it still renders.
  if (verdict.kind === "unmeasured" || verdict.kind === "preview_failed") {
    return verdict.strippedTables > 0 ? (
      <StrippedTablesBlock count={verdict.strippedTables} tableCount={tableCount} />
    ) : null;
  }

  if (verdict.kind === "clear") {
    // The ONLY state entitled to a positive statement, and it is scoped to what
    // the backend actually said — "the preview reported 0", never widened to
    // "nothing was lost". Advisory grey, never green: green would read as a
    // clean bill of health for a document nobody has verified.
    return (
      <p className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        {/* Scoped to the ONE thing the payload covers. It previously read
            "Chunker reported nothing dropped", which an operator reads as
            "nothing was lost" — and which rendered on a prod document whose
            nutrient tables had been stripped before chunking began. The table
            case can no longer reach this branch; the remaining limit (we cannot
            see which chunker ran) is stated in the tooltip. */}
        No short prose fragments were discarded
        {verdict.chunkCount >= 0 && <> — {verdict.chunkCount} chunk{verdict.chunkCount !== 1 ? "s" : ""} from this document</>}
        <InfoTip label={CLEAR_INFOTIP} />
      </p>
    );
  }

  if (verdict.kind === "unconfirmed_clear") {
    // NOT reassurance, and no longer a hedge. The tables are gone — that is
    // established from the backend source, not suspected. The empty dropped
    // list is simply about a different thing.
    //
    // This is the state that renders on PROD `press_note_Nutritional Intake in
    // India`, which previously read "Chunker reported nothing dropped — 9
    // chunks from this document" while 72 rows of calorie/protein/fat intake
    // tables had been deleted before chunking started.
    return <StrippedTablesBlock count={verdict.strippedTables} tableCount={verdict.tableCount} />;
  }

  return (
    <LossBlock
      verdict={verdict}
      tableCount={tableCount}
      ack={ack}
      onAck={onAck}
      expanded={expanded}
      onExpand={onExpand}
      disabled={disabled}
    />
  );
}

// ── Tables deleted before chunking ───────────────────────────────────────────

/**
 * The warning this whole feature was commissioned for, and the one it did not
 * previously give on any real document.
 *
 * Rendered on its own when nothing else was dropped, and INSIDE the loss block
 * when both happened — never suppressed by the presence of the louder warning.
 * The loss block used to gate its table note on `doc.tables.length`, so PROD
 * `DietaryGuidelinesforNINwebsite` rendered four junk fragments (a logo caption,
 * a director's name) and said nothing at all about 1,079 stripped table rows.
 *
 * Amber rather than red: unlike a dropped fragment this is not preventable by
 * the operator — it is what the chunker does to every document — so it informs
 * and never blocks. Blocking on it would fire on most PDFs and be routed around
 * within a week.
 */
function StrippedTablesBlock({
  count,
  tableCount,
  inset,
}: {
  count: number;
  tableCount: number;
  inset?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-amber-500/40 bg-amber-500/10 p-3",
        inset && "bg-amber-500/15"
      )}
    >
      <p className="flex items-start gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        <span>
          {count} table block{count !== 1 ? "s" : ""} {count !== 1 ? "were" : "was"} removed before
          this document was chunked{" "}
          <InfoTip label={STRIPPED_TABLES_INFOTIP} />
        </span>
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        {STRIPPED_TABLES_WARNING}
      </p>
      {tableCount > 0 && (
        <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] leading-relaxed text-muted-foreground">
          The parser also extracted {tableCount} table{tableCount !== 1 ? "s" : ""} from the source —
          check them against the document.{" "}
          <InfoTip label={TABLES_CROSSREF_INFOTIP} />
        </p>
      )}
    </div>
  );
}

// ── The loud one ─────────────────────────────────────────────────────────────

function LossBlock({
  verdict,
  tableCount,
  ack,
  onAck,
  expanded,
  onExpand,
  disabled,
}: Props & { verdict: Extract<DropVerdict, { kind: "loss" }> }) {
  const [copied, setCopied] = useState(false);
  const { fragments, droppedWords, numericCount, tense, strippedTables, storedChunkCount, chunkCount } = verdict;
  const total = fragments.length;
  const needsExpand = total > INITIAL_VISIBLE;
  const visible = expanded || !needsExpand ? fragments : fragments.slice(0, INITIAL_VISIBLE);
  const hidden = total - visible.length;
  // The acknowledgement is only offered where the loss is still preventable.
  // On an already-approved document this is a post-mortem — there is nothing
  // left to consent to, and a checkbox would imply otherwise.
  const isGate = tense === "will";
  const armed = expanded || !needsExpand;

  async function copyAll() {
    // Passages only — no synthetic "— Passage N (M words) —" separators. Those
    // headers were previously part of the copied string, which meant the
    // operator pasted them back INTO the knowledge base as document content,
    // and they also padded the text toward the paste gate's minimums with words
    // that are not from the source.
    const text = fragments.map((f) => f.text).join("\n\n");
    const words = text.split(/\s+/).filter(Boolean).length;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      // Tell the truth about what happens next. Below the paste floor this is
      // not a working repair on its own, and saying so here is cheaper than
      // letting the paste card reject them with a message about character
      // counts that never explains why.
      if (words < PASTE_MIN_WORDS) {
        toast.warning(
          `${total} passage${total !== 1 ? "s" : ""} copied — but ${words} words is under the ${PASTE_MIN_WORDS}-word minimum for Paste text. Paste them together with the surrounding text from the document.`,
          { duration: 10_000 }
        );
      } else {
        toast.success(`${total} passage${total !== 1 ? "s" : ""} copied — paste them back through “Paste text”.`);
      }
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard is permission-gated and blocked outright in some embedded
      // views. Say so rather than leave a button that silently does nothing.
      toast.error("The browser blocked clipboard access — select the passages and copy them by hand.");
    }
  }

  return (
    <div
      // Scroll target for the footer restatement line. Exactly one review mode
      // is mounted at a time, so this id is unique on the page.
      id={DROPPED_BLOCK_ID}
      className="flex scroll-mt-4 flex-col gap-3 rounded-lg border border-red-300 bg-red-50 p-3 sm:p-4 dark:border-red-500/40 dark:bg-red-500/10"
    >
      {/* ── Header: the fact, in the tense that matches the document ─────── */}
      <div className="flex flex-col gap-1">
        <p className="flex items-start gap-2 text-sm font-semibold text-red-800 dark:text-red-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            {total} passage{total !== 1 ? "s" : ""}{" "}
            {/* ⚠️ THREE tenses, not two. "were not stored" is a claim about the
                live knowledge base and may only be made when the preview
                provably describes the stored chunking — see LossTense. On PROD
                `IJMR-148-522` this line used to assert a passage was missing
                that search returns from the KB verbatim. */}
            {tense === "will"
              ? "will not be stored"
              : tense === "did"
              ? "were not stored when this document was approved"
              : "would not be stored if this document were approved today"}
            {/* Only the backend's own summed `words`. Suppressed entirely when
                any fragment lacked one, rather than understating the loss. */}
            {droppedWords !== null && <> — {droppedWords.toLocaleString()} words</>}
            {" "}
            <InfoTip label={DROPPED_COUNT_INFOTIP} />
          </span>
        </p>
        <p className="text-[11px] leading-relaxed text-red-900/90 dark:text-red-200/80">
          {tense === "will" ? (
            <>
              Chunking happens when you approve, not when this document was uploaded. These passages
              are in the document you are about to approve and <strong>will not be in the knowledge
              base</strong>. The assistant will answer as if they were never here.
            </>
          ) : tense === "did" ? (
            <>
              These passages are in the document and <strong>not in the knowledge base</strong>.
              Nothing will retrieve them. If any of it matters, paste it back with its surrounding
              context.
            </>
          ) : (
            <>
              <strong>This is not a reading of the knowledge base.</strong> It is a dry run of the
              current chunker, and it does not match what is actually stored for this document
              {storedChunkCount !== null && chunkCount >= 0 && (
                <> ({storedChunkCount} chunks stored, {chunkCount} in this preview)</>
              )}
              , so these passages may well be in there. Search for one before assuming it is missing.
            </>
          )}
          {numericCount > 0 && (
            <>
              {" "}
              <strong>
                {numericCount === 1
                  ? "1 of them contains numbers."
                  : `${numericCount} of them contain numbers.`}
              </strong>
            </>
          )}
        </p>
        <p className="flex flex-wrap items-center gap-1 text-[11px] leading-relaxed text-red-900/70 dark:text-red-200/60">
          {DROPPED_MECHANISM} <InfoTip label={DROPPED_INFOTIP} />
        </p>
      </div>

      {/* Keyed on the COMPUTED strip count, never on `tables.length` — the old
          gate meant this never rendered on the one prod document with 1,079
          stripped table rows. */}
      {strippedTables > 0 && (
        <StrippedTablesBlock count={strippedTables} tableCount={tableCount} inset />
      )}

      {/* ── The passages, verbatim ───────────────────────────────────────── */}
      <ol className="flex flex-col gap-2">
        {visible.map((f, i) => (
          <FragmentRow key={i} index={i} fragment={f} />
        ))}
      </ol>

      {hidden > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onExpand}
          className="w-full border-red-300 bg-white/60 text-red-900 hover:bg-white dark:border-red-500/40 dark:bg-transparent dark:text-red-200"
        >
          <ChevronDown size={14} className="mr-1.5" />
          Show the remaining {hidden} passage{hidden !== 1 ? "s" : ""}
        </Button>
      )}

      {/* ── Exits: acknowledge, or actually repair the loss ──────────────── */}
      <div className="flex flex-col gap-2 border-t border-red-300/60 pt-3 dark:border-red-500/30">
        {isGate && (
          <>
            <label
              className={cn(
                "flex min-h-11 cursor-pointer items-start gap-2 rounded-md px-1 py-1",
                !armed && "cursor-not-allowed opacity-60"
              )}
            >
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => onAck(e.target.checked)}
                // Armed only once the whole list is on screen. Not a proof of
                // reading — nothing here is — but it makes the cost of the
                // click scale with the size of the loss instead of being flat.
                disabled={disabled || !armed}
                className="mt-1 h-4 w-4 shrink-0 accent-red-700"
              />
              <span className="text-xs font-medium text-red-900 dark:text-red-200">
                {/* Explicit {" "} — the compiler strips the literal space between
                    a JSX expression and the text node that follows it. Verified
                    in a browser: without this it renders "passagesthat". */}
                I&apos;ve read the {total} passage{total !== 1 ? "s" : ""}{" "}
                that won&apos;t be stored
              </span>
            </label>
            {!armed && (
              <p className="px-1 text-[11px] text-red-900/70 dark:text-red-200/60">
                Show the remaining {hidden} passage{hidden !== 1 ? "s" : ""}{" "}
                above to enable this.
              </p>
            )}
          </>
        )}

        <div className="flex flex-col gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copyAll}
            className="w-full border-red-300 bg-white/60 text-red-900 hover:bg-white sm:w-auto dark:border-red-500/40 dark:bg-transparent dark:text-red-200"
          >
            {copied ? <Check size={14} className="mr-1.5" /> : <Copy size={14} className="mr-1.5" />}
            Copy all {total} passage{total !== 1 ? "s" : ""}
          </Button>
          <p className="text-[11px] leading-relaxed text-red-900/70 dark:text-red-200/60">
            {PASTE_BACK_NOTE}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── One passage ──────────────────────────────────────────────────────────────

function FragmentRow({ index, fragment }: { index: number; fragment: DroppedFragment }) {
  const [probe, setProbe] = useState<ProbeOutcome | null>(null);
  const [probing, setProbing] = useState(false);
  const digits = numeralCount(fragment.text);
  // Gated on the text itself, never on the nullable `words` — see MIN_PROBE_WORDS.
  const canProbe = wordCount(fragment.text) >= MIN_PROBE_WORDS;

  async function runProbe() {
    if (probing) return;
    setProbing(true);
    setProbe(await probeRetrieval(fragment.text));
    setProbing(false);
  }

  return (
    <li className="rounded-md border border-red-200 bg-white/70 p-2.5 dark:border-red-500/30 dark:bg-black/20">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-red-900/70 dark:text-red-200/60">
        {/* "Passage N" is the order the preview returned, NOT a page number and
            NOT a position in the document. Labelled so it can't be read as one. */}
        <span className="font-medium">Passage {index + 1}</span>
        <span aria-hidden>·</span>
        {/* NOT `words ?? 0`. A fabricated zero would read as a claim that this
            passage is empty, on the one row where the server told us least. */}
        <span className="tabular-nums">
          {fragment.words === null ? "word count not reported" : `${fragment.words} words`}
        </span>
        {digits > 0 && (
          <>
            <span aria-hidden>·</span>
            {/* A countable property of the string, not an inference about the
                chunker and not a claim that this is a table. Reference ranges
                and doses are numbers — this is the highest-signal honest fact
                the payload allows. */}
            <span className="tabular-nums font-medium text-red-800 dark:text-red-300">
              {digits} number{digits !== 1 ? "s" : ""}
            </span>
          </>
        )}
      </div>

      {/* Verbatim. Monospace + pre-wrap so a whitespace-aligned table still
          looks like a table; per-fragment horizontal scroll so a wide row never
          makes the dialog scroll sideways. */}
      <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground">
        {fragment.text}
      </pre>
      {/* The server slices this text at 200 characters with no ellipsis and no
          flag. This block claims to render the passages verbatim and offers
          them for copy-paste re-ingestion; both claims would be false without
          saying so. Never observed live — the longest fragment on 2026-08-10
          was 168 chars — but the drop floor is 25 words, so it is reachable. */}
      {fragment.truncated && (
        <p className="mt-1 text-[11px] font-medium text-red-800 dark:text-red-300">
          Cut off by the server at 200 characters — this is not the whole passage
          {fragment.words !== null && <> (it is {fragment.words} words)</>}. Find it in the document
          text above.
        </p>
      )}

      {/* ── The probe ──────────────────────────────────────────────────────
          Turns "23 words won't be stored" into "the under-2s monitoring
          interval will be answered with the over-2s rule". One call per tap,
          on demand — never a fan-out when the dialog opens. */}
      {canProbe && (
        <div className="mt-2 border-t border-red-200/70 pt-2 dark:border-red-500/20">
          {probe === null ? (
            <button
              type="button"
              onClick={runProbe}
              disabled={probing}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-red-800 underline underline-offset-2 disabled:opacity-60 dark:text-red-300"
            >
              {probing ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
              {probing ? "Asking the knowledge base…" : "What answers this now?"}
              <InfoTip label={PROBE_INFOTIP} />
            </button>
          ) : (
            <ProbeResultView outcome={probe} />
          )}
        </div>
      )}
    </li>
  );
}

// ── The footer restatement ───────────────────────────────────────────────────

/**
 * A permanent one-line status directly beside Approve.
 *
 * THE SLOT IS NEVER EMPTY. All five verdicts render a line here, in the same
 * place, so the operator learns that this is where the loss report lives — and
 * so a silent footer can never be the render of "not measured". Blank space is
 * exactly what currently reads as "nothing was dropped".
 *
 * It is not dismissible and it interrupts nothing. The inline block carries the
 * comprehension; this guarantees the fact is on screen at the moment of commit
 * however far the operator has scrolled.
 */
export function DropStatusLine({ verdict }: { verdict: DropVerdict }) {
  function scrollToBlock() {
    document.getElementById(DROPPED_BLOCK_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (verdict.kind === "loss") {
    const n = verdict.fragments.length;
    return (
      <button
        type="button"
        onClick={scrollToBlock}
        className="inline-flex items-start gap-1.5 text-left text-[11px] font-medium leading-relaxed text-red-700 underline underline-offset-2 hover:no-underline dark:text-red-400"
      >
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        <span>
          {n} passage{n !== 1 ? "s" : ""}
          {verdict.droppedWords !== null && ` (${verdict.droppedWords.toLocaleString()} words)`}{" "}
          {verdict.tense === "will"
            ? "won't be stored"
            : verdict.tense === "did"
            ? "were not stored"
            : "would not be stored on a re-approve"}{" "}
          — review {n !== 1 ? "them" : "it"}
        </span>
      </button>
    );
  }

  const text =
    verdict.kind === "unmeasured"
      ? "Dropped content was not measured on this server"
      : verdict.kind === "preview_failed"
      ? "Dropped-content check failed — nothing was measured"
      : verdict.kind === "unconfirmed_clear"
      ? `${verdict.strippedTables} table block${verdict.strippedTables !== 1 ? "s" : ""} removed before chunking — not in the knowledge base`
      : "No short prose fragments were discarded";

  return (
    <p className="text-[11px] leading-relaxed text-muted-foreground">{text}</p>
  );
}

function ProbeResultView({ outcome }: { outcome: ProbeOutcome }) {
  if (outcome.kind === "unavailable") {
    // A capability answer, not a failure — and explicitly not "nothing was
    // found", which is what a bare empty result would have implied.
    return (
      <p className="text-[11px] text-muted-foreground">
        Search isn&apos;t available on this server, so we can&apos;t show what would answer this
        instead. That is not the same as nothing answering it.
      </p>
    );
  }
  if (outcome.kind === "error") {
    return <p className="text-[11px] text-red-700 dark:text-red-400">{outcome.message}</p>;
  }

  const { wouldGroundLive, hits } = outcome.result;
  const top = hits[0];

  if (!top) {
    return (
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Without this passage the knowledge base returns <strong>nothing at all</strong> for it. A
        customer asking about this gets no grounded answer.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 text-[11px] leading-relaxed">
      <p className="text-muted-foreground">
        With this passage missing, the closest thing in the knowledge base is{" "}
        <span className="font-medium tabular-nums text-foreground">
          {top.score.toFixed(2)} similarity
        </span>
        {wouldGroundLive > 0 ? (
          <> · {wouldGroundLive} result{wouldGroundLive !== 1 ? "s" : ""} would ground a live answer</>
        ) : (
          <> · nothing here clears the live grounding threshold</>
        )}
      </p>
      {top.source && (
        <p className="break-words font-mono text-[10px] text-muted-foreground">{top.source}</p>
      )}
      {top.snippet && (
        <p className="rounded border border-border bg-muted/40 p-2 text-foreground">{top.snippet}</p>
      )}
      <p className="text-muted-foreground">
        Similarity is not correctness — a close match can be the wrong age band, the wrong test or
        the wrong dose.
      </p>
    </div>
  );
}
