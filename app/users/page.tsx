"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminLayout } from "@/components/AdminLayout";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import api from "@/lib/api";

interface User {
  id: string;
  whatsappPhone: string;
  name: string;
  profileComplete: boolean;
  createdAt: string;
  lastWhatsappActivity: string;
  _count: { lumiConversations: number };
}

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/users?limit=200").then((r) => { setUsers(r.data.users); setLoading(false); });
  }, []);

  const filtered = users.filter(
    (u) =>
      u.name?.toLowerCase().includes(search.toLowerCase()) ||
      u.whatsappPhone.includes(search)
  );

  return (
    <AdminLayout title="Users">
      <div className="flex flex-col gap-4">
        <Input
          placeholder="Search by name or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : (
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u) => (
                  <TableRow
                    key={u.id}
                    className="cursor-pointer hover:bg-accent"
                    onClick={() => router.push(`/users/${u.id}`)}
                  >
                    <TableCell className="font-medium">{u.name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">{u.whatsappPhone}</TableCell>
                    <TableCell>
                      <Badge variant={u.profileComplete ? "default" : "secondary"}>
                        {u.profileComplete ? "Complete" : "Incomplete"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{u._count.lumiConversations}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {u.lastWhatsappActivity ? new Date(u.lastWhatsappActivity).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No users found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
