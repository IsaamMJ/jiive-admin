"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AdminLayout } from "@/components/AdminLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import api from "@/lib/api";

interface Balance {
  userId: string;
  balance: number;
  updatedAt: string;
  user: { id: string; name: string | null; whatsappPhone: string };
}

const PAGE_SIZE = 50;

export default function CreditBalancesPage() {
  const router = useRouter();
  const [balances, setBalances] = useState<Balance[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"balance" | "updatedAt">("updatedAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
      sort,
      order,
    });
    if (search.trim()) params.set("search", search.trim());
    api.get(`/credits?${params.toString()}`).then((r) => {
      setBalances(r.data.balances);
      setTotal(r.data.total);
      setLoading(false);
    });
  }, [offset, sort, order, search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.floor(offset / PAGE_SIZE);

  return (
    <AdminLayout title="Credit Balances">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder="Search name or phone…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
            className="max-w-sm"
          />
          <Select value={sort} onValueChange={(v) => { setSort((v ?? "updatedAt") as "balance" | "updatedAt"); setOffset(0); }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="updatedAt">Last updated</SelectItem>
              <SelectItem value="balance">Balance</SelectItem>
            </SelectContent>
          </Select>
          <Select value={order} onValueChange={(v) => { setOrder((v ?? "desc") as "asc" | "desc"); setOffset(0); }}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">Desc</SelectItem>
              <SelectItem value="asc">Asc</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">{total} users</span>
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
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Last Updated</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balances.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        No balances found
                      </TableCell>
                    </TableRow>
                  ) : balances.map((b) => (
                    <TableRow
                      key={b.userId}
                      className="cursor-pointer hover:bg-accent"
                      onClick={() => router.push(`/users/${b.userId}`)}
                    >
                      <TableCell className="font-medium">{b.user?.name ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{b.user?.whatsappPhone}</TableCell>
                      <TableCell className="text-right font-bold">{b.balance}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(b.updatedAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs text-primary font-medium">View →</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page + 1} of {totalPages}
                </span>
                <Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
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
