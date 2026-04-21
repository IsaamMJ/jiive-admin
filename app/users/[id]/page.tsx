"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import api from "@/lib/api";

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
  conversations: { direction: string; content: string; messageType: string; createdAt: string }[];
  bookings: {
    id: string; patientName: string; testType: string; appointmentDate: string;
    appointmentTime: string; status: string; amount: number; address: { city: string; pincode: number };
  }[];
  memories: { memoryType: string; content: string; relevanceScore: string; createdAt: string }[];
  results: {
    id: string; testType: string; calculatedAge: string; chronologicalAge: string;
    ageDelta: string; status: string; createdAt: string;
  }[];
  creditTransactions: {
    type: string; amount: number; credits: number; description: string;
    balanceAfter: number; createdAt: string;
  }[];
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/users/${id}`).then((r) => { setData(r.data); setLoading(false); });
  }, [id]);

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

  const { user, conversations, bookings, memories, results, creditTransactions } = data;

  return (
    <AdminLayout title={user.name ?? user.whatsappPhone}>
      <Tabs defaultValue="profile" className="flex flex-col gap-4">
        <TabsList className="w-fit">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="conversations">Conversations ({conversations.length})</TabsTrigger>
          <TabsTrigger value="bookings">Bookings ({bookings.length})</TabsTrigger>
          <TabsTrigger value="results">Results ({results.length})</TabsTrigger>
          <TabsTrigger value="memories">Memories ({memories.length})</TabsTrigger>
          <TabsTrigger value="credits">Credits ({creditTransactions.length})</TabsTrigger>
        </TabsList>

        {/* Profile */}
        <TabsContent value="profile">
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Profile</CardTitle></CardHeader>
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
          <div className="flex flex-col gap-2 max-h-[600px] overflow-y-auto pr-1">
            {conversations.length === 0 ? (
              <p className="text-muted-foreground text-sm">No conversations.</p>
            ) : conversations.map((msg, i) => (
              <div key={i} className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${msg.direction === "outbound" ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm"}`}>
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  <p className={`text-xs mt-1 ${msg.direction === "outbound" ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                    {new Date(msg.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
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
                  <TableHead>Test</TableHead>
                  <TableHead>Bio Age</TableHead>
                  <TableHead>Chrono Age</TableHead>
                  <TableHead>Delta</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No results</TableCell></TableRow>
                ) : results.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-accent">
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Memories */}
        <TabsContent value="memories">
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Content</TableHead>
                  <TableHead>Relevance</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memories.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No memories</TableCell></TableRow>
                ) : memories.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell><Badge variant="outline" className="capitalize text-xs">{m.memoryType.replace(/_/g, " ")}</Badge></TableCell>
                    <TableCell className="text-sm max-w-xs">{m.content}</TableCell>
                    <TableCell>{(parseFloat(m.relevanceScore) * 100).toFixed(0)}%</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(m.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Credits */}
        <TabsContent value="credits">
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
                {creditTransactions.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No transactions</TableCell></TableRow>
                ) : creditTransactions.map((t, i) => (
                  <TableRow key={i}>
                    <TableCell><Badge variant="outline" className="capitalize text-xs">{t.type}</Badge></TableCell>
                    <TableCell className="text-sm">{t.description}</TableCell>
                    <TableCell className="text-right font-medium">{t.credits}</TableCell>
                    <TableCell className="text-right">₹{(t.amount / 100).toLocaleString()}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{t.balanceAfter}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}
