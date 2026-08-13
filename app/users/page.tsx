"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InfoTip } from "@/components/InfoTip";
import api from "@/lib/api";
import { isPurgedUser } from "@/lib/utils";

interface User {
  id: string;
  whatsappPhone: string;
  name: string;
  profileComplete: boolean;
  createdAt: string;
  lastWhatsappActivity: string;
  _count: { lumiConversations: number };
}

const PAGE_SIZE = 50;

/**
 * The page size requested from GET /users. Verified live 2026-07-31:
 *   PROD  /users?limit=200 → { users, total, take, hasMore }  total=14    hasMore=false  returned=14
 *   DEV   /users?limit=200 → { users, total, take, hasMore }  total=2194  hasMore=true   returned=200
 * The payload now carries real pagination metadata — use the server's `hasMore`
 * and `total` (below), not the old inference ("exactly FETCH_LIMIT rows came
 * back"), which is flat-out wrong whenever `total` happens to equal the cap.
 * Dev is 2,194 users against this 200 cap right now — not latent, actively
 * truncating today. Dev and prod are not in lockstep on this field yet (other
 * fields in this same release lag on dev), so `hasMore`/`total` are treated as
 * optional and the old length-based inference is the fallback when they're
 * absent — never assume "no more" just because the field is missing.
 * Do not "fix" the 200-cap by raising the limit or paging client-side through
 * the API — a real fix needs pagination UI (separate handoff); this only makes
 * today's limitation visible and honest about how many exist.
 */
const FETCH_LIMIT = 200;

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  // True when the server says more users exist beyond what we fetched. Prefers
  // the real `hasMore` signal; falls back to the old length-inference when the
  // backend we're pointed at doesn't send it yet — see FETCH_LIMIT.
  const [hasMore, setHasMore] = useState(false);
  // The server's total user count, when it reports one (null on a backend that
  // hasn't shipped it yet — see FETCH_LIMIT). Never presented as a total when null.
  const [total, setTotal] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  /**
   * Whether erasure tombstones are listed.
   *
   * Hidden by default: a purged row has no name, no phone, no profile and no
   * detail page behind it, so it is dead weight in a list an operator scans to
   * find someone. It is NEVER silently dropped, though — the count line says how
   * many are hidden and the toggle sits next to it, because "17 users" quietly
   * meaning 14 is the class of bug this admin keeps having.
   *
   * Deliberately not persisted. Reading localStorage in a useState initialiser
   * desyncs from the server render, and the fix (an effect that flips it after
   * mount) makes rows appear and vanish on every load — worse than re-clicking.
   */
  const [showPurged, setShowPurged] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get(`/users?limit=${FETCH_LIMIT}`).then((r) => {
      const data = r.data as { users: User[]; total?: number; hasMore?: boolean };
      const fetched: User[] = data.users;
      setUsers(fetched);
      setHasMore(data.hasMore ?? fetched.length === FETCH_LIMIT);
      setTotal(data.total ?? null);
      setLoading(false);
    });
  }, []);

  /**
   * How many erasure tombstones are in the batch we loaded — NOT in the database.
   * `hasMore` means we only have the first FETCH_LIMIT rows, so this is stated as
   * a property of what's on screen and never as a total.
   */
  const purgedCount = users.filter((u) => isPurgedUser(u.whatsappPhone)).length;

  // Purge filter FIRST, then search. Order matters: a tombstone's phone is the
  // literal string "purged:<uuid>", so with the filter off a search for "purged"
  // would otherwise surface exactly the rows the operator asked to hide.
  const visible = showPurged ? users : users.filter((u) => !isPurgedUser(u.whatsappPhone));

  const filtered = visible.filter(
    (u) =>
      u.name?.toLowerCase().includes(search.toLowerCase()) ||
      u.whatsappPhone.includes(search)
  );

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSearch = (val: string) => { setSearch(val); setPage(0); };
  // Reset the page too — the row count changes, so the current page can fall
  // outside the new range and strand the operator on an empty table.
  const handleTogglePurged = () => { setShowPurged((v) => !v); setPage(0); };

  return (
    <AdminLayout title="Users">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Input
            placeholder="Search by name or phone…"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="max-w-sm"
          />
          <span className="text-sm text-muted-foreground">
            {hasMore ? (
              // An absent `total` is never a positive assurance — only say the
              // real count when the server actually sent one. See FETCH_LIMIT.
              search.trim() !== "" ? (
                <>{filtered.length} match{filtered.length === 1 ? "" : "es"} in first {FETCH_LIMIT}
                {total !== null ? ` of ${total}` : ""} loaded — search may miss customers outside this batch</>
              ) : (
                <>First {FETCH_LIMIT}{total !== null ? ` of ${total}` : ""} users loaded — more exist
                {total === null ? " (server didn't report a total)" : ""}</>
              )
            ) : (
              <>{filtered.length} users</>
            )}
          </span>

          {/* The count above never silently excludes anyone: when tombstones are
              filtered out, say so right next to the number it changed. */}
          {!showPurged && purgedCount > 0 && (
            <span className="text-sm text-muted-foreground">
              · {purgedCount} purged {purgedCount === 1 ? "row" : "rows"} hidden
            </span>
          )}

          {/* Rendered only when the batch actually contains tombstones — a toggle
              for an empty set is a control that does nothing. */}
          {!loading && purgedCount > 0 && (
            <div className="ml-auto flex items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={handleTogglePurged}>
                {showPurged ? (
                  <><EyeOff size={13} className="mr-1.5" />Hide purged</>
                ) : (
                  <><Eye size={13} className="mr-1.5" />Show purged</>
                )}
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                  {purgedCount}
                </span>
              </Button>
              <InfoTip
                side="left"
                label={
                  hasMore
                    ? "Customers who asked to be erased. The row stays as a tombstone — no name, no phone, nothing to open — so it's hidden by default. This counts only the batch loaded here, not every purged customer."
                    : "Customers who asked to be erased. The row stays as a tombstone — no name, no phone, nothing to open — so it's hidden by default. Show them if you're reconciling counts or checking an erasure went through."
                }
              />
            </div>
          )}
        </div>
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Profile</TableHead>
                    <TableHead className="text-right">Conversations</TableHead>
                    <TableHead>Last Active</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((u) => {
                    // Right-to-erasure tombstone (see isPurgedUser, lib/utils.ts).
                    // Verified live: `whatsappPhone` becomes "purged:<uuid>", `name` goes
                    // null, `profileComplete` false. Rendered raw, that reads as an
                    // ordinary customer with a half-finished profile — a person who
                    // exercised erasure must never look like a lead to chase. So: no
                    // fake phone string, no "Incomplete" badge, and the row isn't
                    // clickable (there is nothing actionable behind it).
                    const purged = isPurgedUser(u.whatsappPhone);
                    return (
                      <TableRow
                        key={u.id}
                        className={purged ? "opacity-60" : "cursor-pointer hover:bg-accent"}
                        onClick={purged ? undefined : () => router.push(`/users/${u.id}`)}
                      >
                        <TableCell className="font-medium">{u.name ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {purged ? (
                            <span className="italic">Purged — erased at the customer&apos;s request</span>
                          ) : (
                            <span className="font-mono">{u.whatsappPhone}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {purged ? (
                            <Badge variant="outline">Purged</Badge>
                          ) : (
                            <Badge variant={u.profileComplete ? "default" : "secondary"}>
                              {u.profileComplete ? "Complete" : "Incomplete"}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{u._count.lumiConversations}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {u.lastWhatsappActivity ? new Date(u.lastWhatsappActivity).toLocaleDateString() : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {new Date(u.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {!purged && <span className="text-xs text-primary font-medium">View →</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {paginated.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        {/* "No users found" while rows are filtered out is a claim
                            about the data that is really a claim about the filter.
                            Name the filter so the operator can undo it. */}
                        {!showPurged && purgedCount > 0 ? (
                          <>
                            No users found — {purgedCount} purged{" "}
                            {purgedCount === 1 ? "row is" : "rows are"} hidden.{" "}
                            <button
                              type="button"
                              onClick={handleTogglePurged}
                              className="font-medium text-primary underline underline-offset-2 hover:no-underline"
                            >
                              Show {purgedCount === 1 ? "it" : "them"}
                            </button>
                          </>
                        ) : (
                          "No users found"
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page + 1} of {totalPages}
                </span>
                <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
