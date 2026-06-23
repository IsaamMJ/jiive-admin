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

interface ActionCost {
  id: string;
  actionType: string;
  creditsCost: number;
  description: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function ActionCostsPage() {
  const [costs, setCosts] = useState<ActionCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ActionCost | null>(null);
  const [form, setForm] = useState({ creditsCost: "", description: "", active: true });
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    setLoading(true);
    api.get("/credit-action-costs").then((r) => { setCosts(r.data.costs); setLoading(false); });
  };

  useEffect(() => {
    api.get("/credit-action-costs").then((r) => { setCosts(r.data.costs); setLoading(false); });
  }, []);

  const openEdit = (c: ActionCost) => {
    setEditing(c);
    setForm({ creditsCost: String(c.creditsCost), description: c.description, active: c.active });
    setFormError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSubmitting(true);
    setFormError("");

    const creditsCost = parseInt(form.creditsCost, 10);
    const fail = (msg: string) => { setFormError(msg); setSubmitting(false); };
    if (!Number.isFinite(creditsCost) || creditsCost < 0) return fail("Cost must be >= 0");
    if (!form.description.trim()) return fail("Description required");

    const body: Partial<{ creditsCost: number; description: string; active: boolean }> = {};
    if (creditsCost !== editing.creditsCost) body.creditsCost = creditsCost;
    if (form.description.trim() !== editing.description) body.description = form.description.trim();
    if (form.active !== editing.active) body.active = form.active;

    if (Object.keys(body).length === 0) {
      setEditing(null);
      setSubmitting(false);
      return;
    }

    try {
      await api.patch(`/credit-action-costs/${editing.actionType}`, body);
      toast.success(`Updated ${editing.actionType}`);
      setEditing(null);
      load();
    } catch (err: unknown) {
      setFormError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Update failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminLayout title="Action Costs">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Tune credit costs for paid Lumi actions. Setting cost to 0 keeps the action available for free; unchecking Active hides it entirely.
        </p>

        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {costs.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No paid actions configured</TableCell></TableRow>
                ) : costs.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.actionType}</TableCell>
                    <TableCell className="text-sm max-w-md">{c.description}</TableCell>
                    <TableCell className="text-right font-medium">{c.creditsCost}</TableCell>
                    <TableCell>
                      <Badge variant={c.active ? "default" : "secondary"}>{c.active ? "Active" : "Hidden"}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(c.updatedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>Edit</Button>
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
            <DialogTitle>Edit Action — <span className="font-mono text-sm">{editing?.actionType}</span></DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cost">Credits cost</Label>
              <Input id="cost" type="number" min={0} value={form.creditsCost} onChange={(e) => setForm({ ...form, creditsCost: e.target.value })} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="description">Description</Label>
              <Input id="description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
            </div>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              <span className="text-sm">Active (callers can use this action)</span>
            </label>
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
