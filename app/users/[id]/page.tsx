"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
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
import { toast } from "sonner";
import api from "@/lib/api";

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
    | { type?: "chat"; direction: string; content: string; messageType?: string; createdAt: string }
    | { type: "template"; direction: "outbound"; content: string; templateName: string; status: string; createdAt: string }
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
  }[];
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [txs, setTxs] = useState<CreditTx[]>([]);
  const [txTotal, setTxTotal] = useState(0);
  const [txOffset, setTxOffset] = useState(0);
  const [txLoading, setTxLoading] = useState(false);

  const [grantOpen, setGrantOpen] = useState(false);
  const [grantForm, setGrantForm] = useState({ credits: "", reason: "", notify: true });
  const [grantSubmitting, setGrantSubmitting] = useState(false);
  const [grantError, setGrantError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const loadUser = useCallback(() => {
    api.get(`/users/${id}`).then((r) => { setData(r.data); setLoading(false); });
  }, [id]);

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

  return (
    <AdminLayout title={user.name ?? user.whatsappPhone}>
      <Tabs defaultValue="profile" className="flex flex-col gap-4">
        <TabsList className="w-fit">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="conversations">Conversations ({conversations.length})</TabsTrigger>
          <TabsTrigger value="bookings">Bookings ({bookings.length})</TabsTrigger>
          <TabsTrigger value="results">Results ({results.length})</TabsTrigger>
          <TabsTrigger value="memories">Memories ({memories.length})</TabsTrigger>
          <TabsTrigger value="credits">Credits ({txTotal})</TabsTrigger>
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
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      <p className="text-xs mt-1 text-primary-foreground/60">
                        {new Date(msg.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                );
              }
              return (
                <div key={i} className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${msg.direction === "outbound" ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm"}`}>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    <p className={`text-xs mt-1 ${msg.direction === "outbound" ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                      {new Date(msg.createdAt).toLocaleString()}
                    </p>
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
                  <TableHead>Test</TableHead>
                  <TableHead>Bio Age</TableHead>
                  <TableHead>Chrono Age</TableHead>
                  <TableHead>Delta</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Reminder</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No results</TableCell></TableRow>
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
                    <TableCell className="text-xs">
                      {r.retestReminderSentAt ? (
                        <span className="text-green-400">Sent {new Date(r.retestReminderSentAt).toLocaleDateString()}</span>
                      ) : r.retestReminderOptIn ? (
                        <span className="text-blue-400">Opted in</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
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
