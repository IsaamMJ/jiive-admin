"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import api from "@/lib/api";

interface CreditPack {
  id: string;
  name: string;
  credits: number;
  pricePaise: number;
  active: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface FormState {
  name: string;
  credits: string;
  priceRupees: string;
  displayOrder: string;
  active: boolean;
}

export default function CreditPacksPage() {
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CreditPack | null>(null);
  const [form, setForm] = useState<FormState>({ name: "", credits: "", priceRupees: "", displayOrder: "", active: true });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const load = () => {
    setLoading(true);
    api.get("/credit-packs").then((r) => { setPacks(r.data.packs); setLoading(false); });
  };

  useEffect(() => {
    api.get("/credit-packs").then((r) => { setPacks(r.data.packs); setLoading(false); });
  }, []);

  const openEdit = (p: CreditPack) => {
    setEditing(p);
    setForm({
      name: p.name,
      credits: String(p.credits),
      priceRupees: (p.pricePaise / 100).toString(),
      displayOrder: String(p.displayOrder),
      active: p.active,
    });
    setFormError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSubmitting(true);
    setFormError("");

    const credits = parseInt(form.credits, 10);
    const priceRupees = parseFloat(form.priceRupees);
    const displayOrder = parseInt(form.displayOrder, 10);

    const fail = (msg: string) => { setFormError(msg); setSubmitting(false); };
    if (!form.name.trim()) return fail("Name required");
    if (!Number.isFinite(credits) || credits <= 0) return fail("Credits must be > 0");
    if (!Number.isFinite(priceRupees) || priceRupees <= 0) return fail("Price must be > 0");
    if (!Number.isFinite(displayOrder)) return fail("Display order must be an integer");

    const body: Partial<{ name: string; credits: number; pricePaise: number; displayOrder: number; active: boolean }> = {};
    if (form.name.trim() !== editing.name) body.name = form.name.trim();
    if (credits !== editing.credits) body.credits = credits;
    const pricePaise = Math.round(priceRupees * 100);
    if (pricePaise !== editing.pricePaise) body.pricePaise = pricePaise;
    if (displayOrder !== editing.displayOrder) body.displayOrder = displayOrder;
    if (form.active !== editing.active) body.active = form.active;

    if (Object.keys(body).length === 0) {
      setEditing(null);
      setSubmitting(false);
      return;
    }

    try {
      await api.patch(`/credit-packs/${editing.id}`, body);
      toast.success(`Updated ${editing.name}`);
      setEditing(null);
      load();
    } catch (err: unknown) {
      setFormError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Update failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminLayout title="Credit Packs">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Edit pricing and credits for packs shown in Lumi&apos;s &quot;buy credits&quot; list. Pricing changes apply instantly — no deploy.
        </p>

        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">₹/credit</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packs.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.displayOrder}</TableCell>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-right">{p.credits}</TableCell>
                    <TableCell className="text-right">₹{(p.pricePaise / 100).toLocaleString()}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      ₹{(p.pricePaise / 100 / p.credits).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.active ? "default" : "secondary"}>{p.active ? "Active" : "Hidden"}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(p.updatedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>Edit</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Pack — {editing?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="credits">Credits</Label>
                <Input id="credits" type="number" min={1} value={form.credits} onChange={(e) => setForm({ ...form, credits: e.target.value })} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="price">Price (₹)</Label>
                <Input id="price" type="number" step="0.01" min={0.01} value={form.priceRupees} onChange={(e) => setForm({ ...form, priceRupees: e.target.value })} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="order">Display order</Label>
                <Input id="order" type="number" value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: e.target.value })} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="active">Active</Label>
                <label className="inline-flex items-center gap-2 mt-2">
                  <input id="active" type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                  <span className="text-sm">Visible to users</span>
                </label>
              </div>
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>{submitting ? "Saving…" : "Save"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
