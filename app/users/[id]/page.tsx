"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback, useRef, Fragment } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sparkles, ExternalLink, Reply, RefreshCw, FileText, Image as ImageIcon, Download, Loader2,
  AlertTriangle, Stethoscope, UserRound, UsersRound, Eye, EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { InfoTip } from "@/components/InfoTip";
import { cn } from "@/lib/utils";

/**
 * The chat keeps arriving after the page loaded. Poll while the operator is
 * actually looking at the Conversations tab — not on every tab, and not while
 * the browser tab is in the background (that's a request every 10s for a screen
 * nobody is reading).
 */
const CONVO_POLL_MS = 10000;

/**
 * GET /users/:id hard-codes `take: 50` on the conversation query
 * (jiive-backend admin.controller.ts:1656-1659). There is no parameter that
 * raises it — verified live: ?limit=, ?messageLimit= and ?conversationLimit=
 * are all silently ignored, returning 200 and exactly 50 rows.
 *
 * So when 50 arrive we are almost certainly looking at a TRUNCATED view, and
 * the rows we have are the NEWEST 50 (the query orders createdAt desc) — the
 * oldest messages are the missing ones, which is the opposite of what a chat
 * transcript reading top-to-bottom implies.
 *
 * We deliberately do NOT print a total. The detail payload carries no count
 * (verified: its keys are id, whatsappPhone, name, dob, gender, email,
 * profileComplete, status, createdAt, lastWhatsappActivity, creditBalance).
 * The users LIST has `_count.lumiConversations`, but reaching it from here
 * would mean fetching up to 200 users to read one number, and that list is
 * itself capped. Inventing a total, or implying one by showing a bare "(50)",
 * is the exact defect this label exists to fix — an absent signal is never a
 * positive assurance.
 *
 * Remove all of this once the backend ships the paginated endpoint and the
 * { items, total, hasMore, nextCursor } envelope — see
 * docs/handoff-backend-user-detail-pagination.md.
 */
const CONVO_SERVER_CAP = 50;

const LIVE_EXPLAINER =
  "This chat refreshes itself every 10 seconds while you're on this tab, so new WhatsApp messages appear without you reloading. It pauses when you switch to another browser tab and catches up the moment you come back.";

interface CreditTx {
  id: string;
  type: string;
  amount: number;
  credits: number;
  description: string;
  balanceAfter: number;
  razorpayPaymentId: string | null;
  expiresAt: string | null;
  createdAt: string;
}

const TX_PAGE_SIZE = 20;

const TX_TYPE_COLOR: Record<string, string> = {
  purchase: "bg-green-500/20 text-green-400 border-green-500/30",
  manual_grant: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  usage: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  expiry: "bg-red-500/20 text-red-400 border-red-500/30",
};

/** An option the bot offered on an interactive message. `title` is what the customer saw. */
interface ConvButton {
  id: string;
  title: string;
}

/**
 * A file the customer sent (a lab report PDF, a photo). WhatsApp keeps media ~30
 * days, so `mediaId` is a live handle, not permanent storage — older uploads 404.
 */
interface ConvMedia {
  mediaId: string;
  filename?: string | null;
  mimeType?: string | null;
  caption?: string | null;
}

/**
 * An attachment bubble for a media message. Shows the file up front (icon +
 * name); clicking fetches it through the axios client so the admin bearer token
 * is attached — a plain <a href> would hit the media endpoint unauthenticated and
 * 401, and this is health data.
 *
 * The fetch is deliberately tolerant: the backend media endpoint is rolling out,
 * and WhatsApp only retains media ~30 days, so a miss is EXPECTED, not a crash.
 * A failure says so plainly instead of doing nothing.
 */
function MessageMedia({ media, tone }: { media: ConvMedia; tone: "light" | "dark" }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const isImage = (media.mimeType ?? "").startsWith("image/");
  const label = media.filename?.trim() || (isImage ? "Photo" : "Document");

  async function open() {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    try {
      const r = await api.get(`/media/${encodeURIComponent(media.mediaId)}`, { responseType: "blob" });
      const url = URL.createObjectURL(r.data as Blob);
      // Open in a new tab; the browser renders PDFs/images inline, downloads the rest.
      window.open(url, "_blank", "noopener,noreferrer");
      // Give the tab a moment to grab the blob before we release it.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setFailed(
        status === 404
          ? "File is no longer available (WhatsApp keeps uploads ~30 days)."
          : status === 501 || status === 405
            ? "File viewing isn't switched on yet."
            : "Couldn't load this file."
      );
    } finally {
      setBusy(false);
    }
  }

  const frame =
    tone === "light"
      ? "border-primary-foreground/25 bg-primary-foreground/10 hover:bg-primary-foreground/20"
      : "border-border bg-background/60 hover:bg-background";

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
          frame
        )}
      >
        {busy ? (
          <Loader2 size={16} className="shrink-0 animate-spin opacity-70" />
        ) : isImage ? (
          <ImageIcon size={16} className="shrink-0 opacity-70" />
        ) : (
          <FileText size={16} className="shrink-0 opacity-70" />
        )}
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{label}</span>
          <span className="text-[11px] opacity-60">
            {busy ? "Opening…" : "Tap to open"}
          </span>
        </span>
        <Download size={14} className="ml-auto shrink-0 opacity-50" />
      </button>
      {media.caption?.trim() && <p className="mt-1 text-sm">{media.caption}</p>}
      {failed && <p className="mt-1 text-[11px] text-red-400">{failed}</p>}
    </div>
  );
}

/**
 * The WhatsApp-style option rows shown UNDER a bot message that offered buttons —
 * a reply-arrow + the label the customer saw, exactly as WhatsApp presents them.
 * Rendered only when the backend supplies the button set.
 */
function MessageButtons({ buttons }: { buttons: ConvButton[] }) {
  if (buttons.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col border-t border-primary-foreground/15 pt-1">
      {buttons.map((b) => (
        <div
          key={b.id}
          className="flex items-center gap-2 border-t border-primary-foreground/10 py-1.5 text-sm text-sky-300 first:border-t-0"
        >
          <Reply size={14} className="shrink-0 -scale-x-100" />
          <span>{b.title}</span>
        </div>
      ))}
    </div>
  );
}

interface UserDetail {
  user: {
    id: string;
    whatsappPhone: string;
    name: string;
    dob: string | null;
    gender: string | null;
    email: string | null;
    profileComplete: boolean;
    status: string;
    createdAt: string;
    lastWhatsappActivity: string;
    creditBalance: { balance: number; updatedAt: string } | null;
  };
  conversations: (
    // `displayLabel` is the human label the customer actually saw/tapped for an
    // interactive button ("🧬 Know my Bio-Age"); `content` is the raw payload id
    // ("disc_know_bioage"). The backend resolves it; we prefer it for display.
    //
    // `buttons` are the options the BOT offered on an outbound interactive message
    // (id + the title the customer saw). Rendered as WhatsApp-style option rows
    // under the message. Present only once the backend stores the button set —
    // see docs/handoff-backend-conversation-buttons.md. Absent = nothing extra.
    | { type?: "chat"; direction: string; content: string; displayLabel?: string | null; messageType?: string; media?: ConvMedia | null; buttons?: ConvButton[] | null; createdAt: string }
    | { type: "template"; direction: "outbound"; content: string; displayLabel?: string | null; templateName: string; status: string; media?: ConvMedia | null; buttons?: ConvButton[] | null; createdAt: string }
  )[];
  bookings: {
    id: string; patientName: string; testType: string; appointmentDate: string;
    appointmentTime: string; status: string; amount: number; address: { city: string; pincode: number };
  }[];
  memories: { memoryType: string; content: string; relevanceScore: string; createdAt: string }[];
  results: {
    id: string; testType: string; calculatedAge: string; chronologicalAge: string;
    ageDelta: string; status: string; createdAt: string;
    retestReminderOptIn: boolean; retestReminderSentAt: string | null;
    /** Full shareable report link (latest non-expired token), or null if none. */
    reportUrl?: string | null;
    // WHO this result is for. One account books for several people, so a result
    // is not necessarily the account holder's. `patientName` is the test subject;
    // `relationship` is how they relate to the account holder (FamilyMember, id-
    // linked — not a name match). "self" = the account holder; null = an uploaded
    // report with no booking yet (shows the account-holder name, no relationship).
    patientName?: string | null;
    relationship?: string | null;
    /** FamilyMember id — lets "Ask AI" deep-link to THIS person's context. */
    patientId?: string | null;
  }[];
}

/**
 * "Who is this result for", rendered for the Patient column.
 *
 * The subject's name is the safety-critical bit — it's what stops a result being
 * read as the wrong person's. The relationship is shown only when it adds
 * something: "self" is dropped (it just repeats the account holder in the page
 * title), and null (uploaded reports not yet linked to a family member) shows the
 * name alone. So a family booking reads "Nisha Fathima · Mother"; the account
 * holder's own result reads just "Mohamed Isaam".
 *
 * `accountHolder` is the fallback for pre-deploy rows / uploaded reports that
 * carry no patientName yet — better the account name than a bare dash.
 */
function PatientCell({
  name, relationship, accountHolder,
}: { name?: string | null; relationship?: string | null; accountHolder: string }) {
  const subject = name?.trim() || accountHolder;
  const rel = relationship?.trim();
  const showRel = rel && rel.toLowerCase() !== "self";
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="font-medium">{subject}</span>
      {showRel && (
        <span className="text-xs capitalize text-muted-foreground">· {rel}</span>
      )}
    </span>
  );
}

type ResultRow = UserDetail["results"][number];

/**
 * Group a person's results under one heading. One account is a household, so
 * results belong to PEOPLE — a customer with three tests is one patient, not
 * three rows to scan independently. Grouping keys on the FamilyMember id when we
 * have it (stable), else the name, else a single account bucket for legacy rows
 * that carry no subject yet.
 */
function groupResultsByPatient(results: ResultRow[]) {
  const groups = new Map<string, { key: string; name?: string | null; relationship?: string | null; patientId?: string | null; rows: ResultRow[] }>();
  for (const r of results) {
    const key = r.patientId || r.patientName || "__account__";
    let g = groups.get(key);
    if (!g) {
      g = { key, name: r.patientName, relationship: r.relationship, patientId: r.patientId, rows: [] };
      groups.set(key, g);
    }
    g.rows.push(r);
  }
  return [...groups.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// Memories — Lumi's memory read-back
//
// WHY this tab does NOT use the `memories` array on `GET /users/:id`:
//
//   LumiMemory is SUBJECT-SCOPED by design. The schema says so verbatim
//   (jiive-backend/prisma/schema.prisma:539-541): the subject is "whose fact
//   this is, never inferred from `userId` alone (an account books for a whole
//   family)". Every row carries subjectType / subjectId / subjectKey and the
//   writers populate them for real.
//
//   `GET /users/:id` selects only `memoryType, content, relevanceScore,
//   createdAt` (jiive-backend admin.controller.ts:1683-1692) — the subject is
//   dropped entirely. So a fact extracted about the MOTHER ("diabetic, on
//   metformin") rendered here as the ACCOUNT HOLDER's condition. That query
//   also has no `state` filter, so rows Lumi itself cannot see (staged) and
//   rows that have already been replaced (superseded) rendered identically to
//   current, confirmed facts.
//
//   Its `relevanceScore` column was worse than useless: lumi-memory.service.ts
//   :19-22 records that it "is only ever set/reset to 1.0 ... relevanceScore
//   never varies". The old "Relevance 100%" cell was a column DEFAULT printed
//   as if it were a measurement.
//
// The backend declined to widen /users/:id and pointed at the read-back
// surface, which returns the subject, the lifecycle state and the confidence
// signals: `GET /lumi/memory/:phone` (memory-readback.service.ts:84-192).
// Phone-keyed, not id-keyed — the service normalises a bare 10-digit number to
// the 91-prefixed form itself.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lifecycle state (schema.prisma LumiMemoryState). Only `active` reaches a real
 * conversation — retrieval and the active-fact unique index see `state =
 * 'active'` ONLY, so a staged row is structurally invisible to Lumi.
 */
type MemoryState =
  | "staged_pending_consent"
  | "staged_pending_confirm"
  | "active"
  | "superseded"
  | "archived";

interface MemoryFact {
  id: string;
  /** Namespaced taxonomy key, e.g. "allergy.penicillin". Open vocabulary. */
  factKey: string | null;
  category: string | null;
  content: string;
  /** "self" = the account holder. ANY other value is a different human being. */
  subjectType: string;
  /** FamilyMember FK. Null on a non-self row means the subject is unidentifiable. */
  subjectId: string | null;
  /** Backend's own dedup key — 'self' | 'family:<id>'. Never null. */
  subjectKey: string;
  /** 'self' | the family member's name | 'family (unresolved)'. See SubjectHeader. */
  subjectLabel: string;
  /** Typed loosely: the DB column is TEXT with a growing vocabulary, not an enum. */
  state: MemoryState | string;
  clinical: boolean;
  /** Only ever true via user_confirmed / results_corroborated — never LLM self-report. */
  verified: boolean;
  /** Hedged mention — "I *think* I'm allergic". Not a finding. */
  unconfirmed: boolean;
  /** Confidence in the fact's CONTENT. null = never scored — not 0, not high. */
  confidence: number | null;
  /** Confidence in WHOSE fact it is. null = never scored. */
  attributionConfidence: number | null;
  sourceType: string | null;
  sourceMessageId: string | null;
  createdAt: string;
  supersededAt: string | null;
  archivedAt: string | null;
}

interface MemoryReadback {
  /** null when the read-back service finds no account for that phone number. */
  user: { id: string; name: string | null; whatsappPhone: string } | null;
  counts: {
    /** Over the FULL fact set, never capped by `limit` — so dormancy is visible. */
    total: number;
    /** Partial: a state the backend adds later must not crash this page. */
    byState: Partial<Record<MemoryState, number>>;
    clinical: number;
    clinicalActive: number;
  };
  /** Rolling account summary. `text: null` means none was ever generated. */
  summary: { text: string | null; updatedAt: string | null };
  /** Most-recent-first, bounded to `limit`. */
  facts: MemoryFact[];
  limit: number;
}

/** The endpoint clamps to 200. Ask for the ceiling so truncation is rare. */
const MEMORY_LIMIT = 200;

/**
 * The sentinel the backend emits when a non-self fact's FamilyMember row is
 * gone (memory-readback.service.ts:150-151). It is NOT a person's name — it is
 * "we know this is about someone else and we can no longer say who".
 */
const UNRESOLVED_SUBJECT_LABEL = "family (unresolved)";

const MEMORY_STATE_META: Record<string, { label: string; tip: string; chip: string }> = {
  active: {
    label: "Active",
    tip: "Lumi can see and use this right now. Active is the only state that reaches a real conversation.",
    chip: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  },
  staged_pending_consent: {
    label: "Staged · needs consent",
    tip: "Written down but parked. Lumi's own memory lookup cannot see staged rows, so this is NOT something Lumi knows. It is waiting for the customer to agree we may keep it.",
    chip: "border-slate-500/40 bg-slate-500/10 text-slate-300",
  },
  staged_pending_confirm: {
    label: "Staged · needs confirming",
    tip: "Written down but parked. Lumi's own memory lookup cannot see staged rows. We asked the customer to confirm it and haven't had an answer yet.",
    chip: "border-slate-500/40 bg-slate-500/10 text-slate-300",
  },
  superseded: {
    label: "Superseded",
    tip: "Replaced by a newer fact. It was true once — treat it as history, not as what we know today.",
    chip: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  },
  archived: {
    label: "Archived",
    tip: "Retired from use and kept only for the record. Lumi does not read archived rows.",
    chip: "border-slate-500/40 bg-slate-500/10 text-slate-400",
  },
};

const isActiveFact = (f: MemoryFact) => f.state === "active";

const CLINICAL_TIP =
  "A health fact — an allergy, a medication, a condition. These carry real consequences if they are wrong or attached to the wrong person, so they are marked separately from things like 'prefers morning slots'.";
const UNCONFIRMED_TIP =
  "The customer hedged — \"I think I'm allergic to penicillin\". It is a mention, not a finding. Never act on it as if it were confirmed.";
const VERIFIED_TIP =
  "Confirmed either by the customer saying so outright, or by a lab result backing it up. Lumi cannot mark this itself. No badge simply means it hasn't been confirmed — that is the normal state for most facts, not a warning.";
const CONFIDENCE_TIP =
  "How sure the extractor was that it read the FACT correctly. \"Not scored\" means nobody ever put a number on it — it is not zero and not high, it was simply never measured.";
const ATTRIBUTION_TIP =
  "How sure the extractor was about WHO this fact is about — a separate question from whether the fact itself is right. \"Not scored\" means it was never measured, so the person named above is not guaranteed.";

interface SubjectGroup {
  key: string;
  label: string;
  subjectKey: string;
  isSelf: boolean;
  /** The dangerous case: a fact about someone we can no longer name. */
  unresolved: boolean;
  facts: MemoryFact[];
}

/**
 * Group facts by the PERSON they are about — the same shape the Results tab
 * uses, for the same reason: one account is a household, so a fact belongs to
 * a human being, not to the login.
 *
 * `unresolved` is derived structurally, not by trusting the label alone:
 * subjectType tells us it is not the account holder, and a null subjectId on
 * such a row is exactly the failure the sentinel label describes.
 *
 * The group key keeps two DIFFERENT unresolved subjects apart (they carry
 * different subjectKeys) rather than merging them into a single bucket that
 * would read as one mystery relative.
 */
function groupFactsBySubject(facts: MemoryFact[]): SubjectGroup[] {
  const groups = new Map<string, SubjectGroup>();
  for (const f of facts) {
    const isSelf = f.subjectType === "self";
    const unresolved =
      !isSelf && (f.subjectId === null || f.subjectLabel === UNRESOLVED_SUBJECT_LABEL);
    const key = isSelf ? "__self__" : `${f.subjectId ?? "?"}|${f.subjectKey}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, label: f.subjectLabel, subjectKey: f.subjectKey, isSelf, unresolved, facts: [] };
      groups.set(key, g);
    }
    g.facts.push(f);
  }
  // Account holder first, then named family, then the unresolved ones — which
  // carry their own alarm banner, so they read loudly wherever they land.
  return [...groups.values()].sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    if (a.unresolved !== b.unresolved) return a.unresolved ? 1 : -1;
    return a.label.localeCompare(b.label);
  });
}

/**
 * A 0..1 score, or the honest absence of one.
 *
 * `null` means NOBODY EVER SCORED THIS. Printing it as 0%, as an empty bar, or
 * in any confident colour would invent a measurement — the exact bug class this
 * screen was rebuilt to remove. So null prints the words "not scored".
 *
 * Only LOW scores get colour. A high score stays neutral on purpose: a number
 * is a number, and we are not in the business of turning it into reassurance.
 */
function ScoreChip({ label, value, tip }: { label: string; value: number | null; tip: string }) {
  const scored = typeof value === "number" && Number.isFinite(value);
  const pct = scored ? Math.round((value as number) * 100) : null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] leading-none">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-medium tabular-nums",
          !scored ? "text-muted-foreground/70 italic" : pct !== null && pct < 50 ? "text-amber-400" : "text-foreground"
        )}
      >
        {scored ? `${pct}%` : "not scored"}
      </span>
      <InfoTip label={tip} />
    </span>
  );
}

/**
 * One fact. Non-active rows are deliberately dimmed and badged — a staged row
 * is invisible to Lumi and a superseded row has been replaced, so neither may
 * read like current knowledge sitting in the same list as one.
 */
function FactCard({ fact }: { fact: MemoryFact }) {
  const active = isActiveFact(fact);
  const meta = MEMORY_STATE_META[fact.state];
  const retiredAt = fact.supersededAt ?? fact.archivedAt;

  return (
    <div className={cn("border-t border-border px-3 py-3 first:border-t-0", !active && "bg-muted/30")}>
      <div className="flex flex-wrap items-center gap-1.5">
        {fact.clinical && (
          <Badge variant="outline" className="gap-1 border-rose-500/40 bg-rose-500/10 px-1.5 text-[10px] text-rose-300">
            <Stethoscope size={11} />
            Clinical
            <InfoTip label={CLINICAL_TIP} />
          </Badge>
        )}
        {/* Active carries no badge — it is the default view, and a chip on every
            row would drown the ones that actually need reading. */}
        {!active && (
          <Badge variant="outline" className={cn("gap-1 px-1.5 text-[10px]", meta?.chip)}>
            {meta?.label ?? fact.state}
            {meta && <InfoTip label={meta.tip} />}
          </Badge>
        )}
        {fact.unconfirmed && (
          <Badge variant="outline" className="gap-1 border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] text-amber-300">
            Unconfirmed
            <InfoTip label={UNCONFIRMED_TIP} />
          </Badge>
        )}
        {/* Rendered only when TRUE. `verified: false` is the ordinary state of
            most facts, so a "not verified" chip would cry wolf on every row. */}
        {fact.verified && (
          <Badge variant="outline" className="gap-1 border-sky-500/40 bg-sky-500/10 px-1.5 text-[10px] text-sky-300">
            Verified
            <InfoTip label={VERIFIED_TIP} />
          </Badge>
        )}
        {fact.category && (
          <Badge variant="outline" className="px-1.5 text-[10px] capitalize">
            {fact.category.replace(/_/g, " ")}
          </Badge>
        )}
      </div>

      <p className={cn("mt-2 text-sm break-words whitespace-pre-wrap", !active && "text-muted-foreground")}>
        {fact.content}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <ScoreChip label="Fact confidence" value={fact.confidence} tip={CONFIDENCE_TIP} />
        <ScoreChip label="Who it's about" value={fact.attributionConfidence} tip={ATTRIBUTION_TIP} />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
        {fact.factKey && <span className="font-mono">{fact.factKey}</span>}
        {fact.sourceType && <span>· {fact.sourceType.replace(/_/g, " ")}</span>}
        <span>· {new Date(fact.createdAt).toLocaleDateString()}</span>
        {retiredAt && (
          <span>
            · {fact.supersededAt ? "superseded" : "archived"} {new Date(retiredAt).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Who a block of facts belongs to.
 *
 * Three cases, and the third is the reason this whole tab was rebuilt:
 *   self       — the account holder. Tinted with the primary colour so their own
 *                facts never blend into a relative's.
 *   named      — a real family member, named.
 *   unresolved — a fact known to be about SOMEONE ELSE whose family-member
 *                record is gone. It must never be read as the account holder's,
 *                so it gets an alarm banner rather than a quiet grey heading.
 */
function SubjectHeader({ group, accountHolder }: { group: SubjectGroup; accountHolder: string }) {
  if (group.unresolved) {
    return (
      <div className="flex items-start gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold break-words text-amber-200">
            Someone else on this account — NOT {accountHolder}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-amber-200/80">
            These were recorded about another person on this account, but that family
            member&apos;s record no longer exists, so we cannot say who. Do not read them
            as {accountHolder}&apos;s.
          </p>
          <p className="mt-1 font-mono text-[10px] break-all text-amber-200/60">{group.subjectKey}</p>
        </div>
        <Badge variant="outline" className="shrink-0 border-amber-500/40 text-[10px] text-amber-200">
          {group.facts.length}
        </Badge>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-2",
        group.isSelf ? "bg-primary/10" : "bg-muted/40"
      )}
    >
      {group.isSelf ? (
        <UserRound size={14} className="shrink-0 text-primary" />
      ) : (
        <UsersRound size={14} className="shrink-0 text-muted-foreground" />
      )}
      <span className="text-sm font-medium break-words">{group.isSelf ? accountHolder : group.label}</span>
      <span className="text-xs text-muted-foreground">
        · {group.isSelf ? "account holder" : "family member"}
      </span>
      <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
        {group.facts.length}
      </Badge>
    </div>
  );
}

/** One number from `counts`, with the plain-language reason it matters. */
function CountChip({ label, value, tip, tone }: { label: string; value: number; tip: string; tone?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1">
      <span className={cn("text-sm font-semibold tabular-nums", tone)}>{value}</span>
      <span className="truncate text-[11px] text-muted-foreground">{label}</span>
      <InfoTip label={tip} />
    </div>
  );
}

/**
 * Turn an axios failure into something an operator can act on. The server's own
 * message wins wherever it exists — a paraphrase has cost us debugging hours
 * before. 403 is called out separately because this endpoint is gated harder
 * than the rest of the page (RolesGuard + `admin` role), so a token that loads
 * every other tab can still be refused here.
 */
function memoryErrorMessage(e: unknown): string {
  const err = e as {
    response?: { status?: number; data?: { message?: string | string[]; error?: string } };
    message?: string;
  };
  const status = err?.response?.status;
  const body = err?.response?.data;
  const server = Array.isArray(body?.message) ? body.message.join(", ") : body?.message ?? body?.error;
  if (status === 404) {
    return "This backend doesn't have the memory read-back endpoint yet (404 on /lumi/memory). Nothing is wrong with the account.";
  }
  if (status === 403) {
    return server || "Your admin account isn't allowed to read memory (403). This endpoint needs the 'admin' role.";
  }
  if (server) return `${status ?? "Request failed"}: ${server}`;
  return err?.message || "Couldn't load memories.";
}

/**
 * The Memories tab body, once a read-back has actually arrived.
 *
 * Default view shows ACTIVE facts only. Staged / superseded / archived rows sit
 * behind a toggle because they are not current knowledge — a staged row is
 * structurally invisible to Lumi's own retrieval and a superseded row has been
 * replaced — and mixing them into the same list is how "I *think* I'm allergic"
 * came to look identical to a confirmed allergy.
 */
function MemoriesPanel({
  readback, accountHolder, showInactive, onToggleInactive, refreshing, onRefresh, staleError,
}: {
  readback: MemoryReadback;
  accountHolder: string;
  showInactive: boolean;
  onToggleInactive: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  /** A refresh that failed while data was already on screen. Warn, don't blank. */
  staleError: string | null;
}) {
  const { counts, facts, summary } = readback;
  const byState = counts.byState;
  const stagedCount = (byState.staged_pending_consent ?? 0) + (byState.staged_pending_confirm ?? 0);

  const inactiveLoaded = facts.filter((f) => !isActiveFact(f)).length;
  const visible = showInactive ? facts : facts.filter(isActiveFact);
  const groups = groupFactsBySubject(visible);
  // `counts` reads the whole set; `facts` is a page. Say so rather than letting
  // a capped list read as the complete picture.
  const hidden = counts.total - facts.length;

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
            What Lumi remembers
            <InfoTip label="Facts Lumi has written down from conversations and results. One account can cover a whole family, so every fact below is filed under the person it is actually about." />
          </CardTitle>
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {staleError && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300">
              Showing the last good read — the refresh failed: {staleError}
            </p>
          )}

          <div className="flex flex-wrap gap-1.5">
            <CountChip
              label="recorded"
              value={counts.total}
              tip="Every row ever written for this account, in any state — including ones Lumi cannot use."
            />
            <CountChip
              label="active"
              value={byState.active ?? 0}
              tone="text-emerald-400"
              tip="Facts Lumi can actually see and use in a conversation. This is the number that describes what Lumi knows."
            />
            <CountChip
              label="staged"
              value={stagedCount}
              tip="Written down but parked, waiting on the customer's consent or confirmation. Lumi's memory lookup cannot see staged rows, so they are NOT things Lumi knows."
            />
            <CountChip
              label="superseded"
              value={byState.superseded ?? 0}
              tip="Replaced by a newer fact. History, not current knowledge."
            />
            <CountChip
              label="archived"
              value={byState.archived ?? 0}
              tip="Retired from use, kept only for the record. Lumi does not read these."
            />
            <CountChip
              label={`clinical active (of ${counts.clinical})`}
              value={counts.clinicalActive}
              tone={counts.clinicalActive > 0 ? "text-rose-300" : undefined}
              tip="Health facts — allergies, medications, conditions — that Lumi can currently use. The number in brackets counts every clinical row in any state."
            />
          </div>

          <div className="rounded-md border border-border bg-muted/20 p-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium">Account summary</span>
              <InfoTip label="A short rolling description of the account that Lumi keeps alongside the individual facts. It is generated automatically, not written by a person." />
              {summary.updatedAt && (
                <span className="ml-auto text-[10px] text-muted-foreground">
                  updated {new Date(summary.updatedAt).toLocaleDateString()}
                </span>
              )}
            </div>
            {summary.text ? (
              <p className="mt-1.5 text-sm break-words whitespace-pre-wrap">{summary.text}</p>
            ) : (
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground italic">
                No summary has ever been generated for this account. That is the absence of a
                summary — not a statement that there is nothing to report.
              </p>
            )}
          </div>

          {hidden > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Showing the {facts.length} most recent of {counts.total} recorded rows.
              {" "}{hidden} older {hidden === 1 ? "row is" : "rows are"} not on this page.
            </p>
          )}

          {inactiveLoaded > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onToggleInactive}>
                {showInactive ? <EyeOff size={12} /> : <Eye size={12} />}
                {showInactive ? "Hide" : "Show"} staged, superseded &amp; archived ({inactiveLoaded})
              </Button>
              <InfoTip label="These rows exist in the database but Lumi does not use them: staged rows are waiting on the customer, superseded rows have been replaced, archived rows are retired. Hidden by default so they can't be mistaken for current facts." />
            </div>
          )}
        </CardContent>
      </Card>

      {counts.total === 0 ? (
        <div className="rounded-lg border border-border px-3 py-8 text-center">
          <p className="text-sm text-muted-foreground">Lumi hasn&apos;t recorded anything for this account yet.</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Nothing has been written down. That is not the same as knowing there is nothing to know.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-border px-3 py-8 text-center">
          <p className="text-sm text-muted-foreground">No active facts.</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            {inactiveLoaded > 0
              ? `${inactiveLoaded} recorded ${inactiveLoaded === 1 ? "row is" : "rows are"} staged, superseded or archived — Lumi uses none of them. Use the toggle above to read them.`
              : "Nothing on this page is active."}
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.key} className="overflow-hidden rounded-lg border border-border">
            <SubjectHeader group={group} accountHolder={accountHolder} />
            {group.facts.map((f) => (
              <FactCard key={f.id} fact={f} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

/**
 * Render WhatsApp inline formatting the way WhatsApp itself does, so the admin
 * conversation reads like the real chat instead of showing raw markers:
 *   *bold*   _italic_   ~strikethrough~   ```monospace```
 * Anything that isn't a complete, non-empty pair is left as literal text.
 */
function formatWhatsApp(text: string, keyBase: string) {
  // One token = a whole *…* / _…_ / ~…~ / ```…``` run. Split keeps the delimiters.
  const TOKEN = /(```[^`]+```|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;
  return text.split(TOKEN).map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (/^```[^`]+```$/.test(part))
      return <code key={key} className="rounded bg-black/20 px-1 font-mono text-[0.9em] dark:bg-white/15">{part.slice(3, -3)}</code>;
    if (/^\*[^*\n]+\*$/.test(part)) return <strong key={key}>{part.slice(1, -1)}</strong>;
    if (/^_[^_\n]+_$/.test(part)) return <em key={key}>{part.slice(1, -1)}</em>;
    if (/^~[^~\n]+~$/.test(part)) return <del key={key}>{part.slice(1, -1)}</del>;
    return <span key={key}>{part}</span>;
  });
}

/**
 * Render a message body the way WhatsApp shows it: inline formatting (bold/italic/
 * strike/mono) applied, and any URL turned into a clickable link that opens in a
 * new tab — so an operator taps to open a report instead of copy-pasting it.
 */
function MessageBody({ content }: { content: string }) {
  // Links first (no formatting inside a URL); format the text between links.
  const parts = content.split(/(https?:\/\/[^\s]+)/g);
  return (
    <p className="whitespace-pre-wrap break-words">
      {parts.map((part, i) => {
        if (!/^https?:\/\//.test(part)) return <span key={i}>{formatWhatsApp(part, String(i))}</span>;
        const trailing = part.match(/[)\].,;:'"]+$/)?.[0] ?? "";
        const href = trailing ? part.slice(0, -trailing.length) : part;
        return (
          <span key={i}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 break-all underline underline-offset-2 hover:opacity-80"
            >
              {href}
              <ExternalLink size={12} className="shrink-0" />
            </a>
            {trailing}
          </span>
        );
      })}
    </p>
  );
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState("profile");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const convoScrollRef = useRef<HTMLDivElement | null>(null);
  /** Was the operator pinned to the bottom before this refresh? Decided pre-render. */
  const wasAtBottomRef = useRef(true);
  const convoCountRef = useRef(0);

  const [txs, setTxs] = useState<CreditTx[]>([]);
  const [txTotal, setTxTotal] = useState(0);
  const [txOffset, setTxOffset] = useState(0);
  const [txLoading, setTxLoading] = useState(false);

  // Memories. Held here, not inside the tab panel, because Base UI unmounts an
  // inactive Tabs.Panel — state living in the panel would be thrown away and
  // refetched every time the operator flicked between tabs, and every fetch
  // writes an `[AUDIT] memory-readback by admin ...` line server-side.
  //
  // Both the payload and the error are stamped with the user id they belong to.
  // The App Router reuses this component when you navigate /users/a -> /users/b,
  // so an unstamped cache would show one customer's clinical facts under
  // another customer's name for as long as the refetch takes.
  const [mem, setMem] = useState<{ forUserId: string; data: MemoryReadback } | null>(null);
  const [memError, setMemError] = useState<{ forUserId: string; message: string } | null>(null);
  const [memRefreshing, setMemRefreshing] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  /** Which user id we've already fired a read-back for — stops the effect looping. */
  const memRequestedForRef = useRef<string | null>(null);

  const [grantOpen, setGrantOpen] = useState(false);
  const [grantForm, setGrantForm] = useState({ credits: "", reason: "", notify: true });
  const [grantSubmitting, setGrantSubmitting] = useState(false);
  const [grantError, setGrantError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const loadUser = useCallback(() => {
    api.get(`/users/${id}`).then((r) => { setData(r.data); setLoading(false); });
  }, [id]);

  /**
   * A silent re-fetch: no skeleton, no toast, and a failure leaves the messages
   * already on screen alone. A dropped poll is not worth blanking the chat — the
   * next tick fixes it, and the "updated HH:MM:SS" stamp shows if it went stale.
   */
  const refreshUser = useCallback(async () => {
    const el = convoScrollRef.current;
    wasAtBottomRef.current = el
      ? el.scrollHeight - el.scrollTop - el.clientHeight < 80
      : true;
    setRefreshing(true);
    try {
      const r = await api.get(`/users/${id}`);
      setData(r.data);
      setRefreshedAt(new Date());
    } catch {
      // Keep what's on screen; the next tick will try again.
    } finally {
      setRefreshing(false);
    }
  }, [id]);

  // Poll only while the Conversations tab is open AND the browser tab is visible.
  useEffect(() => {
    if (activeTab !== "conversations") return;

    const tick = () => {
      if (document.visibilityState === "visible") refreshUser();
    };
    const timer = setInterval(tick, CONVO_POLL_MS);

    // Coming back to the tab shouldn't mean waiting out the rest of the interval.
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshUser();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [activeTab, refreshUser]);

  const conversationCount = data?.conversations.length ?? 0;

  // New messages land at the bottom. Follow them only if the operator was already
  // there — yanking someone who scrolled up to read history is worse than stale.
  useEffect(() => {
    if (activeTab !== "conversations") return;
    const el = convoScrollRef.current;
    if (!el) return;
    const grew = conversationCount > convoCountRef.current;
    convoCountRef.current = conversationCount;
    if (grew && wasAtBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [activeTab, conversationCount]);

  /**
   * Read memory back from the subject-aware endpoint.
   *
   * Note there is no synchronous setState here before the first await — the
   * "loading" state is DERIVED (no payload and no error yet) rather than
   * flagged, so the tab-open effect below stays free of cascading renders.
   *
   * A failed refresh keeps whatever is already on screen and shows the error
   * beside it: blanking a screen of clinical facts because one poll failed is
   * worse than showing them with a visible "this didn't refresh" warning.
   */
  const loadMemories = useCallback(async (forUserId: string, phone: string) => {
    try {
      const r = await api.get(`/lumi/memory/${encodeURIComponent(phone)}?limit=${MEMORY_LIMIT}`);
      setMem({ forUserId, data: r.data as MemoryReadback });
      setMemError(null);
    } catch (e) {
      setMemError({ forUserId, message: memoryErrorMessage(e) });
    }
  }, []);

  const memPhone = data?.user.whatsappPhone;

  // Fetch when the operator actually opens the tab. Not on page load: this
  // endpoint returns raw clinical content and writes a server-side audit line
  // naming who read which phone, so it shouldn't fire for someone who only
  // came to grant credits.
  useEffect(() => {
    if (activeTab !== "memories" || !memPhone) return;
    if (memRequestedForRef.current === id) return;
    memRequestedForRef.current = id;
    void loadMemories(id, memPhone);
  }, [activeTab, id, memPhone, loadMemories]);

  const refreshMemories = async () => {
    if (memRefreshing || !memPhone) return;
    setMemRefreshing(true);
    await loadMemories(id, memPhone);
    setMemRefreshing(false);
  };

  const loadTxPage = useCallback((offset: number) => {
    setTxLoading(true);
    api.get(`/users/${id}/credit-transactions?limit=${TX_PAGE_SIZE}&offset=${offset}`).then((r) => {
      setTxs(r.data.transactions);
      setTxTotal(r.data.total);
      setTxOffset(offset);
      setTxLoading(false);
    });
  }, [id]);

  useEffect(() => {
    api.get(`/users/${id}`).then((r) => { setData(r.data); setLoading(false); });
    api.get(`/users/${id}/credit-transactions?limit=${TX_PAGE_SIZE}&offset=0`).then((r) => {
      setTxs(r.data.transactions);
      setTxTotal(r.data.total);
      setTxOffset(0);
    });
  }, [id]);

  const submitGrant = async () => {
    setGrantSubmitting(true);
    setGrantError("");
    const credits = parseInt(grantForm.credits, 10);
    if (!Number.isFinite(credits) || credits <= 0) {
      setGrantError("Credits must be > 0");
      setGrantSubmitting(false);
      return;
    }
    if (!grantForm.reason.trim()) {
      setGrantError("Reason required");
      setGrantSubmitting(false);
      return;
    }
    try {
      const r = await api.post(`/users/${id}/grant-credits`, {
        credits,
        reason: grantForm.reason.trim(),
        notify: grantForm.notify,
      });
      toast.success(`Granted ${credits} credits. New balance: ${r.data.newBalance}`);
      setConfirmOpen(false);
      setGrantOpen(false);
      setGrantForm({ credits: "", reason: "", notify: true });
      loadUser();
      loadTxPage(0);
    } catch (err: unknown) {
      setGrantError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Grant failed");
    } finally {
      setGrantSubmitting(false);
    }
  };

  const txPage = Math.floor(txOffset / TX_PAGE_SIZE);
  const txTotalPages = Math.max(1, Math.ceil(txTotal / TX_PAGE_SIZE));

  if (loading) return (
    <AdminLayout title="User Detail">
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
      </div>
    </AdminLayout>
  );

  if (!data) return (
    <AdminLayout title="User Detail">
      <p className="text-muted-foreground">User not found.</p>
    </AdminLayout>
  );

  const { user, conversations, bookings, memories, results } = data;

  // Only trust the cached read-back if it belongs to the user on screen — see
  // the note on the `mem` state above.
  const memView = mem && mem.forUserId === id ? mem.data : null;
  const memErr = memError && memError.forUserId === id ? memError.message : null;
  // Derived, not flagged: nothing has arrived and nothing has failed yet.
  const memLoading = !memView && !memErr;
  const accountHolder = user.name ?? user.whatsappPhone;

  return (
    <AdminLayout title={user.name ?? user.whatsappPhone}>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col gap-4">
        <TabsList className="w-fit">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          {/* "50+" not "50": at the cap the number is a page size, not a count. */}
          <TabsTrigger value="conversations">
            Conversations ({conversations.length}
            {conversations.length >= CONVO_SERVER_CAP ? "+" : ""})
          </TabsTrigger>
          <TabsTrigger value="bookings">Bookings ({bookings.length})</TabsTrigger>
          <TabsTrigger value="results">Results ({results.length})</TabsTrigger>
          {/* Falls back to the legacy array's length until the read-back lands —
              same table, same unfiltered total, so the number doesn't jump. */}
          <TabsTrigger value="memories">Memories ({memView?.counts.total ?? memories.length})</TabsTrigger>
          <TabsTrigger value="credits">Credits ({txTotal})</TabsTrigger>
        </TabsList>

        {/* Profile */}
        <TabsContent value="profile">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-sm font-medium">Profile</CardTitle>
              <Link href={`/playground?userId=${id}`}>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Sparkles size={14} />
                  Ask AI about this patient
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div><p className="text-muted-foreground">Phone</p><p className="font-mono">{user.whatsappPhone}</p></div>
              <div><p className="text-muted-foreground">Name</p><p>{user.name ?? "—"}</p></div>
              <div><p className="text-muted-foreground">Email</p><p>{user.email ?? "—"}</p></div>
              <div><p className="text-muted-foreground">Gender</p><p className="capitalize">{user.gender ?? "—"}</p></div>
              <div><p className="text-muted-foreground">Date of Birth</p><p>{user.dob ? new Date(user.dob).toLocaleDateString() : "—"}</p></div>
              <div><p className="text-muted-foreground">Status</p><div className="mt-1"><StatusBadge status={user.status} /></div></div>
              <div><p className="text-muted-foreground">Profile Complete</p>
                <Badge variant={user.profileComplete ? "default" : "secondary"} className="mt-1">
                  {user.profileComplete ? "Yes" : "No"}
                </Badge>
              </div>
              <div><p className="text-muted-foreground">Credit Balance</p><p className="text-xl font-bold">{user.creditBalance?.balance ?? 0}</p></div>
              <div><p className="text-muted-foreground">Joined</p><p>{new Date(user.createdAt).toLocaleDateString()}</p></div>
              <div><p className="text-muted-foreground">Last Active</p><p>{user.lastWhatsappActivity ? new Date(user.lastWhatsappActivity).toLocaleDateString() : "—"}</p></div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Conversations */}
        <TabsContent value="conversations">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span>
                Live
                {refreshedAt && ` · updated ${refreshedAt.toLocaleTimeString()}`}
              </span>
              <InfoTip label={LIVE_EXPLAINER} />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={refreshUser}
              disabled={refreshing}
            >
              <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
          {/* Sits ABOVE the transcript and scrolls with nothing — the missing
              messages are the OLDEST, so this belongs where the reader's eye
              starts, not at the bottom where they'd never reach it. */}
          {conversations.length >= CONVO_SERVER_CAP && (
            <div className="mb-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <p>
                Showing the most recent {CONVO_SERVER_CAP} messages. This is the server&apos;s limit,
                not the whole conversation — anything older is not loaded, and there is currently no
                way to fetch it from here.
                <InfoTip label="The backend caps this list at 50 and sends no total, so we can't tell you how many more exist. A paginated endpoint has been requested — see docs/handoff-backend-user-detail-pagination.md." />
              </p>
            </div>
          )}
          <div ref={convoScrollRef} className="flex flex-col gap-2 max-h-[600px] overflow-y-auto pr-1">
            {conversations.length === 0 ? (
              <p className="text-muted-foreground text-sm">No conversations.</p>
            ) : conversations.map((msg, i) => {
              if (msg.type === "template") {
                const failed = msg.status?.toLowerCase() === "failed";
                return (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2 text-sm">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Badge
                          variant="outline"
                          className={`px-1.5 py-0 text-[10px] ${failed ? "border-red-500/40 bg-red-500/20 text-red-300" : "border-primary-foreground/30 bg-primary-foreground/15 text-primary-foreground/90"}`}
                        >
                          Template
                        </Badge>
                        <span className="text-[10px] text-primary-foreground/70">{msg.templateName}</span>
                        {failed && <span className="text-[10px] text-red-300">· failed</span>}
                      </div>
                      {msg.media ? (
                        <MessageMedia media={msg.media} tone="light" />
                      ) : (
                        <MessageBody content={msg.displayLabel ?? msg.content} />
                      )}
                      <p className="text-xs mt-1 text-primary-foreground/60">
                        {new Date(msg.createdAt).toLocaleString()}
                      </p>
                      {msg.buttons && <MessageButtons buttons={msg.buttons} />}
                    </div>
                  </div>
                );
              }
              return (
                <div key={i} className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${msg.direction === "outbound" ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm"}`}>
                    {msg.media ? (
                      <MessageMedia media={msg.media} tone={msg.direction === "outbound" ? "light" : "dark"} />
                    ) : (
                      <MessageBody content={msg.displayLabel ?? msg.content} />
                    )}
                    <p className={`text-xs mt-1 ${msg.direction === "outbound" ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                      {new Date(msg.createdAt).toLocaleString()}
                    </p>
                    {msg.buttons && <MessageButtons buttons={msg.buttons} />}
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* Bookings */}
        <TabsContent value="bookings">
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Test</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>City</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No bookings</TableCell></TableRow>
                ) : bookings.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.patientName}</TableCell>
                    <TableCell className="capitalize">{b.testType.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-xs">{new Date(b.appointmentDate).toLocaleDateString()}</TableCell>
                    <TableCell className="text-xs">{b.appointmentTime}</TableCell>
                    <TableCell><StatusBadge status={b.status} /></TableCell>
                    <TableCell className="text-right">₹{(b.amount / 100).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{b.address?.city ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Results */}
        <TabsContent value="results">
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Test</TableHead>
                  <TableHead>Bio Age</TableHead>
                  <TableHead>Chrono Age</TableHead>
                  <TableHead>Delta</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Reminder</TableHead>
                  <TableHead className="text-right">Report</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">No results</TableCell></TableRow>
                ) : groupResultsByPatient(results).map((group) => (
                  <Fragment key={group.key}>
                    {/* One heading per person — carries who they are + one "Ask AI"
                        that loads THIS patient's whole history, never blended. */}
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={8} className="py-2">
                        <PatientCell name={group.name} relationship={group.relationship} accountHolder={user.name ?? user.whatsappPhone} />
                      </TableCell>
                      <TableCell className="py-2 text-right">
                        {/* Renders only once the result carries a FamilyMember id;
                            until the backend exposes it, no dead button. */}
                        {group.patientId && (
                          <Link href={`/playground?patientId=${group.patientId}`}>
                            <Button variant="outline" size="sm" className="gap-1.5">
                              <Sparkles size={13} />
                              Ask AI
                            </Button>
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                    {group.rows.map((r) => (
                      <TableRow key={r.id} className="cursor-pointer hover:bg-accent">
                        <TableCell />
                        <TableCell>
                          <Link href={`/results/${r.id}`} className="capitalize hover:underline text-primary">
                            {r.testType.replace(/_/g, " ")}
                          </Link>
                        </TableCell>
                        <TableCell>{r.calculatedAge ?? "—"}</TableCell>
                        <TableCell>{r.chronologicalAge ?? "—"}</TableCell>
                        <TableCell className={parseFloat(r.ageDelta) < 0 ? "text-green-400" : "text-red-400"}>{r.ageDelta ?? "—"}</TableCell>
                        <TableCell><StatusBadge status={r.status} /></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell className="text-xs">
                          {r.retestReminderSentAt ? (
                            <span className="text-green-400">Sent {new Date(r.retestReminderSentAt).toLocaleDateString()}</span>
                          ) : r.retestReminderOptIn ? (
                            <span className="text-blue-400">Opted in</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          {r.reportUrl ? (
                            <a href={r.reportUrl} target="_blank" rel="noopener noreferrer" className="inline-flex">
                              <Button variant="outline" size="sm">
                                <ExternalLink size={13} className="mr-1.5" />
                                Open report
                              </Button>
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">No link</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Memories — see the block comment above `MemoryFact` for why this reads
            /lumi/memory/:phone instead of the `memories` array on /users/:id. */}
        <TabsContent value="memories">
          {memLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-40" />
              <Skeleton className="h-32" />
            </div>
          ) : !memView ? (
            <Card>
              <CardContent className="flex flex-col items-start gap-2 py-6">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <AlertTriangle size={15} className="shrink-0 text-amber-400" />
                  Couldn&apos;t load memories
                </p>
                <p className="text-xs break-words text-muted-foreground">{memErr}</p>
                <p className="text-[11px] text-muted-foreground/70">
                  This is a failure to read, not an empty memory. Nothing has been ruled out.
                </p>
                <Button variant="outline" size="sm" className="mt-1 h-7 gap-1.5 text-xs" onClick={refreshMemories} disabled={memRefreshing}>
                  <RefreshCw size={12} className={memRefreshing ? "animate-spin" : ""} />
                  {memRefreshing ? "Retrying…" : "Try again"}
                </Button>
              </CardContent>
            </Card>
          ) : !memView.user ? (
            /* The read-back is phone-keyed. A null user means it matched no
               account for this number — a different thing from "no memories",
               and a sign the stored phone doesn't match what WhatsApp delivers. */
            <Card>
              <CardContent className="flex flex-col items-start gap-2 py-6">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <AlertTriangle size={15} className="shrink-0 text-amber-400" />
                  No account matched this phone number
                </p>
                <p className="text-xs text-muted-foreground">
                  Memory is looked up by phone number, and{" "}
                  <span className="font-mono">{user.whatsappPhone}</span> matched nothing. We can&apos;t
                  say what Lumi remembers about this customer — not that it remembers nothing.
                </p>
              </CardContent>
            </Card>
          ) : (
            <MemoriesPanel
              readback={memView}
              accountHolder={accountHolder}
              showInactive={showInactive}
              onToggleInactive={() => setShowInactive((v) => !v)}
              refreshing={memRefreshing}
              onRefresh={refreshMemories}
              staleError={memErr}
            />
          )}
        </TabsContent>

        {/* Credits */}
        <TabsContent value="credits">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="text-muted-foreground">Current balance: </span>
                <span className="text-xl font-bold">{user.creditBalance?.balance ?? 0}</span>
              </div>
              <Button onClick={() => { setGrantForm({ credits: "", reason: "", notify: true }); setGrantError(""); setGrantOpen(true); }}>
                Grant credits
              </Button>
            </div>

            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Credits</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Balance After</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {txLoading ? (
                    <TableRow><TableCell colSpan={6}><Skeleton className="h-8" /></TableCell></TableRow>
                  ) : txs.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No transactions</TableCell></TableRow>
                  ) : txs.map((t) => {
                    const cls = TX_TYPE_COLOR[t.type] ?? "bg-slate-500/20 text-slate-400 border-slate-500/30";
                    const signed = t.credits > 0 ? `+${t.credits}` : String(t.credits);
                    return (
                      <TableRow key={t.id}>
                        <TableCell><Badge variant="outline" className={`text-xs ${cls}`}>{t.type.replace(/_/g, " ")}</Badge></TableCell>
                        <TableCell className="text-sm">{t.description}</TableCell>
                        <TableCell className={`text-right font-medium ${t.credits > 0 ? "text-green-400" : "text-orange-400"}`}>{signed}</TableCell>
                        <TableCell className="text-right">₹{(t.amount / 100).toLocaleString()}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{t.balanceAfter}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString()}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {txTotalPages > 1 && (
              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" disabled={txOffset === 0} onClick={() => loadTxPage(Math.max(0, txOffset - TX_PAGE_SIZE))}>
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">Page {txPage + 1} of {txTotalPages}</span>
                <Button variant="outline" size="sm" disabled={txOffset + TX_PAGE_SIZE >= txTotal} onClick={() => loadTxPage(txOffset + TX_PAGE_SIZE)}>
                  Next
                </Button>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grant credits to {user.name ?? user.whatsappPhone}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); setConfirmOpen(true); }}
            className="flex flex-col gap-4 mt-2"
          >
            <div className="text-sm text-muted-foreground">
              Current balance: <span className="font-bold text-foreground">{user.creditBalance?.balance ?? 0}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="credits">Credits to grant</Label>
              <Input id="credits" type="number" min={1} value={grantForm.credits}
                onChange={(e) => setGrantForm({ ...grantForm, credits: e.target.value })} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reason">Reason (logged in audit + sent to user)</Label>
              <Input id="reason" value={grantForm.reason}
                onChange={(e) => setGrantForm({ ...grantForm, reason: e.target.value })} required />
            </div>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={grantForm.notify}
                onChange={(e) => setGrantForm({ ...grantForm, notify: e.target.checked })} />
              <span className="text-sm">Notify user via WhatsApp</span>
            </label>
            {grantError && <p className="text-sm text-destructive">{grantError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setGrantOpen(false)}>Cancel</Button>
              <Button type="submit">Review</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm credit grant</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 mt-2 text-sm">
            <p>
              Grant <span className="font-bold">{grantForm.credits} credits</span> to{" "}
              <span className="font-bold">{user.name ?? user.whatsappPhone}</span>?
            </p>
            <p className="text-muted-foreground">Reason: {grantForm.reason}</p>
            <p className="text-muted-foreground">
              New balance will be {(user.creditBalance?.balance ?? 0) + (parseInt(grantForm.credits, 10) || 0)}.
              {grantForm.notify ? " User will be notified on WhatsApp." : " User will NOT be notified."}
            </p>
            <p className="text-destructive text-xs">This cannot be undone.</p>
            {grantError && <p className="text-sm text-destructive">{grantError}</p>}
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Back</Button>
              <Button onClick={submitGrant} disabled={grantSubmitting}>
                {grantSubmitting ? "Granting…" : "Confirm grant"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
