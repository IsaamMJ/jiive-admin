"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminLayout } from "@/components/AdminLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
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
 * The page size requested from GET /users. Verified live: the response has
 * ONLY a `users` key — no total, no pagination metadata — so there is no way
 * to know if more users exist beyond this limit. Getting back exactly this many
 * is the only signal we have; see `truncated` below. Today there are 14 users,
 * so this is latent, but at 201 the header would otherwise show "200 users"
 * forever and search would silently miss anyone past it. Do not "fix" this by
 * raising the limit or paging client-side through the API — a real fix needs
 * backend pagination (separate handoff); this only makes the limitation visible.
 */
const FETCH_LIMIT = 200;

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  // True when GET /users came back with exactly FETCH_LIMIT rows — see FETCH_LIMIT.
  const [truncated, setTruncated] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/users?limit=${FETCH_LIMIT}`).then((r) => {
      const fetched: User[] = r.data.users;
      setUsers(fetched);
      setTruncated(fetched.length === FETCH_LIMIT);
      setLoading(false);
    });
  }, []);

  const filtered = users.filter(
    (u) =>
      u.name?.toLowerCase().includes(search.toLowerCase()) ||
      u.whatsappPhone.includes(search)
  );

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSearch = (val: string) => { setSearch(val); setPage(0); };

  return (
    <AdminLayout title="Users">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Input
            placeholder="Search by name or phone…"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="max-w-sm"
          />
          <span className="text-sm text-muted-foreground">
            {truncated ? (
              // An absent signal (no `total` on the wire) is never a positive
              // assurance — never render this as a definite count. See FETCH_LIMIT.
              search.trim() !== "" ? (
                <>{filtered.length} match{filtered.length === 1 ? "" : "es"} in first {FETCH_LIMIT} loaded —
                search may miss customers outside this batch</>
              ) : (
                <>First {FETCH_LIMIT} users loaded — more may exist (server doesn&apos;t report a total)</>
              )
            ) : (
              <>{filtered.length} users</>
            )}
          </span>
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
                        No users found
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
