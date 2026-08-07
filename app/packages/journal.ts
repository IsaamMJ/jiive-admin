import { apiHost } from "./api";
import type { PanelIdentity } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// The switch journal — the ONLY memory of a panel we replaced
//
// WHY THIS EXISTS: PATCH /packages/:testType writes no audit row. The controller
// logs field NAMES only —
//     admin.controller.ts:3862
//     `[AUDIT] package-update by admin=… testType=… fields=pricePaise,skuType`
// — so once the row is overwritten, the PREVIOUS SKU, type and price exist
// NOWHERE on the server. Not in auditLog, not in a history table, not in the
// log line. If the operator switches the primary panel and wants it back, this
// file is the only place the old values can come from.
//
// WHY THE KEY CARRIES THE API HOST: dev's primary is FBS/PSKU, prod's is
// PROJ1062813/OFFER, and PROJ1062813 does not exist in dev's catalog at all. A
// journal shared across environments would offer, in one tap, to "restore" a dev
// SKU onto the LIVE CUSTOMER-FACING prod row. Keying on the host makes that
// unrepresentable rather than merely unlikely.
//
// HONEST LIMIT, stated wherever this is surfaced: this is localStorage. It is
// per-browser and per-device. It is not a server audit trail and must never be
// described as one. The backend ask that would replace it is an auditLog row on
// package.update carrying beforeJson/afterJson — the auditLog table already
// exists and /audit-log already renders that diff shape.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = `jiive.packages.journal.v1::${apiHost()}`;

/** Newest first, per testType. Enough to undo a bad afternoon, not a history UI. */
const MAX_PER_TYPE = 5;

export type JournalStatus =
  /** Written BEFORE the PATCH went out. If we see this on mount, the tab died
   *  mid-write and we do not know whether it landed. */
  | "pending"
  /** The read-back diff passed. The change is live and this is a real undo point. */
  | "confirmed"
  /** We proved the row is still the pre-write value. Nothing happened. */
  | "failed"
  /** The row is neither what we sent nor what it was. Somebody else changed it,
   *  or the write landed partially. We refuse to guess which. */
  | "unresolved";

export interface JournalEntry {
  id: string;
  /** ISO — when we STARTED the write, not when it finished. */
  at: string;
  testType: string;
  /** The row as the server held it before we touched it. The restore source. */
  before: PanelIdentity & { isActive: boolean };
  /** What we sent. Compared against the live row to reconcile a `pending`. */
  after: PanelIdentity & { isActive: boolean };
  /** The row's updatedAt before the write — used to spot a third-party change. */
  beforeUpdatedAt: string;
  status: JournalStatus;
}

function readAll(): JournalEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as JournalEntry[]) : [];
  } catch {
    // A corrupt entry must not take the packages page down. An unreadable
    // journal is the same as an empty one — and the empty state says plainly
    // that there is no restore point, rather than implying there was nothing
    // to restore.
    return [];
  }
}

function writeAll(entries: JournalEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* quota / private mode — the switch itself still works */
  }
}

function newId(): string {
  // crypto.randomUUID is unavailable on http:// origins in some browsers, and
  // this id is only a local dedupe key — a timestamp+random is sufficient and
  // cannot throw.
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * WRITE-AHEAD. Call this BEFORE api.patch fires — that is the entire trick.
 *
 * If the entry were written after a successful response, then the exact case it
 * exists for (the response never arrives, the tab is closed, the phone sleeps)
 * is the case where nothing gets recorded and the old panel is lost forever.
 * Written first, a dead tab leaves a `pending` entry that ReconcileBanner
 * resolves against the live row on next mount.
 */
export function beginSwitch(
  testType: string,
  before: PanelIdentity & { isActive: boolean },
  after: PanelIdentity & { isActive: boolean },
  beforeUpdatedAt: string,
): JournalEntry {
  const entry: JournalEntry = {
    id: newId(),
    at: new Date().toISOString(),
    testType,
    before,
    after,
    beforeUpdatedAt,
    status: "pending",
  };
  const all = readAll();
  const forType = [entry, ...all.filter((e) => e.testType === testType)].slice(0, MAX_PER_TYPE);
  const others = all.filter((e) => e.testType !== testType);
  writeAll([...forType, ...others]);
  return entry;
}

export function setStatus(id: string, status: JournalStatus): void {
  writeAll(readAll().map((e) => (e.id === id ? { ...e, status } : e)));
}

/**
 * Drop an entry entirely. Used for a no-op save: the server accepted the
 * request and changed nothing, so there is no "previous panel" — offering to
 * restore to a value that is still live would be nonsense.
 */
export function discard(id: string): void {
  writeAll(readAll().filter((e) => e.id !== id));
}

export function entriesFor(testType: string): JournalEntry[] {
  return readAll().filter((e) => e.testType === testType);
}

/** The most recent confirmed switch for a row — the one-tap restore point. */
export function latestRestorePoint(testType: string): JournalEntry | null {
  return entriesFor(testType).find((e) => e.status === "confirmed") ?? null;
}

/**
 * The latest restore point for EVERY row that has one, newest first.
 *
 * WHY THIS EXISTS: page.tsx called latestRestorePoint("primary") with the string
 * hardcoded, while the switch affordance sits on every row in the table (prod
 * has 6 rows, dev 8). So a confirmed switch on cardiac/kidney/brain wrote a
 * perfectly good journal entry that was never read, and the bar rendered its
 * empty state — "No switch history in this browser yet" — which is a positive
 * claim of absence manufactured from a lookup that was never performed, one
 * screen after the confirm dialog promised BY NAME that we were saving those
 * exact values. The empty state is only honest if we actually looked everywhere.
 */
export function allRestorePoints(): JournalEntry[] {
  const seen = new Set<string>();
  const out: JournalEntry[] = [];
  for (const e of readAll()) {
    if (e.status !== "confirmed" || seen.has(e.testType)) continue;
    seen.add(e.testType);
    out.push(e);
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** Any row's pending entry. Resolved on mount before anything else renders. */
export function pendingEntries(): JournalEntry[] {
  return readAll().filter((e) => e.status === "pending");
}

/** Does this identity match the live row? Used to reconcile a pending entry. */
export function identityMatches(
  snapshot: PanelIdentity & { isActive: boolean },
  live: {
    displayName: string;
    description?: string | null;
    thyrocareSkuId: string;
    skuType: string;
    pricePaise: number;
    requiresFasting: boolean;
    fastingHours: number;
    isActive: boolean;
  },
): boolean {
  return (
    snapshot.displayName === live.displayName &&
    (snapshot.description ?? "") === (live.description ?? "") &&
    snapshot.thyrocareSkuId === live.thyrocareSkuId &&
    snapshot.skuType === live.skuType &&
    snapshot.pricePaise === live.pricePaise &&
    snapshot.requiresFasting === live.requiresFasting &&
    snapshot.fastingHours === live.fastingHours &&
    snapshot.isActive === live.isActive
  );
}

/**
 * What a `pending` entry turned out to mean, decided by comparing the snapshot
 * against the row as it is RIGHT NOW.
 *
 * The third outcome is the important one. If the live row matches neither what
 * we sent nor what was there before, something else changed it — another tab,
 * another admin, or a partial write. We report that honestly and offer both
 * values, rather than picking the more comfortable of the two explanations.
 * Guessing here is how a "restore" silently reverts somebody else's fix.
 */
export type ReconcileVerdict = Exclude<JournalStatus, "pending">;

export function reconcile(
  entry: JournalEntry,
  live: Parameters<typeof identityMatches>[1],
): ReconcileVerdict {
  if (identityMatches(entry.after, live)) return "confirmed";
  if (identityMatches(entry.before, live)) return "failed";
  return "unresolved";
}

/** "12 days ago" / "3 hours ago" / "just now" — relative, because the operator
 *  cares how stale the restore point is, not what o'clock it was. */
export function agoLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "at an unknown time";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ${hrs === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}
