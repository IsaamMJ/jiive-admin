"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Check, X, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { cn } from "@/lib/utils";

interface Package {
  testType: string;
  displayName: string;
  description?: string;
  pricePaise: number;
  thyrocareSkuId: string;
  skuType: string;
  requiresFasting: boolean;
  fastingHours: number;
  isActive: boolean;
  displayOrder: number;
  updatedAt: string;
}

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function PackagesPage() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingType, setEditingType] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [priceError, setPriceError] = useState("");
  const [saving, setSaving] = useState(false);
  const [togglingType, setTogglingType] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    testType: "", displayName: "", thyrocareSkuId: "", price: "",
    skuType: "OFFER", description: "", requiresFasting: true,
    fastingHours: "12", displayOrder: "", isActive: false,
  });
  const [addError, setAddError] = useState("");
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    api.get("/packages").then((r) => { setPackages(r.data.packages); setLoading(false); });
  };

  useEffect(() => {
    api.get("/packages").then((r) => { setPackages(r.data.packages); setLoading(false); });
  }, []);

  const openEdit = (p: Package) => {
    setEditingType(p.testType);
    setPriceInput(String(p.pricePaise / 100));
    setPriceError("");
  };

  const cancelEdit = () => {
    setEditingType(null);
    setPriceInput("");
    setPriceError("");
  };

  const toggleActive = async (p: Package) => {
    const next = !p.isActive;
    setTogglingType(p.testType);
    // optimistic flip
    setPackages((prev) => prev.map((x) => (x.testType === p.testType ? { ...x, isActive: next } : x)));
    try {
      await api.patch(`/packages/${p.testType}`, { isActive: next });
      toast.success(`${p.displayName} ${next ? "activated" : "deactivated"}`);
    } catch (err: unknown) {
      // revert on failure
      setPackages((prev) => prev.map((x) => (x.testType === p.testType ? { ...x, isActive: p.isActive } : x)));
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Update failed");
    } finally {
      setTogglingType(null);
    }
  };

  const openAdd = () => {
    setAddForm({
      testType: "", displayName: "", thyrocareSkuId: "", price: "",
      skuType: "OFFER", description: "", requiresFasting: true,
      fastingHours: "12", displayOrder: String(packages.length), isActive: false,
    });
    setAddError("");
    setAddOpen(true);
  };

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError("");
    const fail = (msg: string) => setAddError(msg);

    const testType = addForm.testType.trim().toLowerCase();
    if (!/^[a-z0-9_]+$/.test(testType)) return fail("testType must be lowercase letters, digits, or underscores");
    if (!addForm.displayName.trim()) return fail("Display name required");
    if (!addForm.thyrocareSkuId.trim()) return fail("Thyrocare SKU required");

    const rupeeValue = parseFloat(addForm.price);
    if (!Number.isFinite(rupeeValue) || rupeeValue < 0) return fail("Enter a price ≥ 0");
    const pricePaise = Math.round(rupeeValue * 100);

    const fastingHours = parseInt(addForm.fastingHours, 10);
    if (!Number.isInteger(fastingHours) || fastingHours < 0 || fastingHours > 24) return fail("Fasting hours must be 0–24");

    const displayOrder = parseInt(addForm.displayOrder, 10);
    if (!Number.isInteger(displayOrder) || displayOrder < 0) return fail("Display order must be ≥ 0");

    const body = {
      testType,
      displayName: addForm.displayName.trim(),
      thyrocareSkuId: addForm.thyrocareSkuId.trim(),
      pricePaise,
      skuType: addForm.skuType,
      description: addForm.description.trim() || undefined,
      requiresFasting: addForm.requiresFasting,
      fastingHours,
      displayOrder,
      isActive: addForm.isActive,
    };

    setCreating(true);
    try {
      await api.post("/packages", body);
      toast.success(`Created ${body.displayName}${body.isActive ? "" : " (inactive)"}`);
      setAddOpen(false);
      load();
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) return fail(`A package with testType "${testType}" already exists`);
      setAddError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const savePrice = async (p: Package) => {
    setPriceError("");
    const rupeeValue = parseFloat(priceInput);
    if (!Number.isFinite(rupeeValue) || rupeeValue < 0) {
      setPriceError("Enter a price ≥ 0");
      return;
    }
    const pricePaise = Math.round(rupeeValue * 100);
    if (pricePaise === p.pricePaise) {
      cancelEdit();
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/packages/${p.testType}`, { pricePaise });
      toast.success(`${p.displayName} → ${rupees(pricePaise)}`);
      cancelEdit();
      load();
    } catch (err: unknown) {
      setPriceError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout title="Packages">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Customer-facing price for each bookable Thyrocare package. Editing a price affects new bookings only — existing bookings keep their captured amount.
          </p>
          <Button size="sm" className="shrink-0" onClick={openAdd}>
            <Plus size={15} /> Add package
          </Button>
        </div>

        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Package</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Fasting</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packages.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No packages configured</TableCell></TableRow>
                ) : packages.map((p) => {
                  const editing = editingType === p.testType;
                  return (
                    <TableRow key={p.testType}>
                      <TableCell className="text-muted-foreground tabular-nums">{p.displayOrder}</TableCell>
                      <TableCell>
                        <div className="font-medium">{p.displayName}</div>
                        <div className="font-mono text-xs text-muted-foreground">{p.testType}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-xs">{p.thyrocareSkuId}</div>
                        <div className="text-xs text-muted-foreground">{p.skuType}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {p.requiresFasting ? `${p.fastingHours}h` : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={p.isActive}
                            aria-label={`${p.isActive ? "Deactivate" : "Activate"} ${p.displayName}`}
                            disabled={togglingType === p.testType}
                            onClick={() => toggleActive(p)}
                            className={cn(
                              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                              p.isActive ? "bg-primary" : "bg-muted-foreground/30"
                            )}
                          >
                            <span
                              className={cn(
                                "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                                p.isActive ? "translate-x-[18px]" : "translate-x-0.5"
                              )}
                            />
                          </button>
                          <span className={cn("text-xs", p.isActive ? "text-foreground" : "text-muted-foreground")}>
                            {p.isActive ? "Active" : "Inactive"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {editing ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1">
                              <span className="text-sm text-muted-foreground">₹</span>
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                autoFocus
                                className="h-8 w-28"
                                value={priceInput}
                                onChange={(e) => setPriceInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") savePrice(p);
                                  if (e.key === "Escape") cancelEdit();
                                }}
                                disabled={saving}
                              />
                              <Button size="icon" variant="ghost" className="h-8 w-8" disabled={saving} onClick={() => savePrice(p)}>
                                <Check size={15} />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8" disabled={saving} onClick={cancelEdit}>
                                <X size={15} />
                              </Button>
                            </div>
                            {priceError && <span className="text-xs text-destructive">{priceError}</span>}
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openEdit(p)}
                            className="group inline-flex items-center gap-1.5 font-medium hover:text-primary transition-colors"
                          >
                            {rupees(p.pricePaise)}
                            <Pencil size={13} className="opacity-0 group-hover:opacity-60 transition-opacity" />
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(p.updatedAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={(v) => { if (!creating) setAddOpen(v); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add package</DialogTitle>
            <DialogDescription>
              Creates a new bookable package. Only add a Thyrocare SKU confirmed live by Adhish — a wrong/inactive SKU makes orders fail at Thyrocare. New packages start inactive.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitAdd} className="flex flex-col gap-3 mt-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="testType">testType (slug)</Label>
                <Input id="testType" placeholder="liver" value={addForm.testType}
                  onChange={(e) => setAddForm({ ...addForm, testType: e.target.value })} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="displayName">Display name</Label>
                <Input id="displayName" placeholder="LIVER HEALTH" value={addForm.displayName}
                  onChange={(e) => setAddForm({ ...addForm, displayName: e.target.value })} required />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="thyrocareSkuId">Thyrocare SKU</Label>
                <Input id="thyrocareSkuId" placeholder="PROJ10628XX" value={addForm.thyrocareSkuId}
                  onChange={(e) => setAddForm({ ...addForm, thyrocareSkuId: e.target.value })} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="skuType">SKU type</Label>
                <select id="skuType" value={addForm.skuType}
                  onChange={(e) => setAddForm({ ...addForm, skuType: e.target.value })}
                  className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                  <option value="OFFER">OFFER</option>
                  <option value="SSKU">SSKU</option>
                  <option value="PSKU">PSKU</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="price">Price (₹)</Label>
                <Input id="price" type="number" min={0} step="0.01" placeholder="1999" value={addForm.price}
                  onChange={(e) => setAddForm({ ...addForm, price: e.target.value })} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fastingHours">Fasting (h)</Label>
                <Input id="fastingHours" type="number" min={0} max={24} value={addForm.fastingHours}
                  onChange={(e) => setAddForm({ ...addForm, fastingHours: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="displayOrder">Order</Label>
                <Input id="displayOrder" type="number" min={0} value={addForm.displayOrder}
                  onChange={(e) => setAddForm({ ...addForm, displayOrder: e.target.value })} />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="description">Description (optional)</Label>
              <Input id="description" value={addForm.description}
                onChange={(e) => setAddForm({ ...addForm, description: e.target.value })} />
            </div>

            <div className="flex items-center gap-6">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={addForm.requiresFasting}
                  onChange={(e) => setAddForm({ ...addForm, requiresFasting: e.target.checked })} />
                <span className="text-sm">Requires fasting</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={addForm.isActive}
                  onChange={(e) => setAddForm({ ...addForm, isActive: e.target.checked })} />
                <span className="text-sm">Active immediately</span>
              </label>
            </div>

            {addError && <p className="text-sm text-destructive">{addError}</p>}
            <div className="flex justify-end gap-2 mt-1">
              <Button type="button" variant="ghost" disabled={creating} onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={creating}>{creating ? "Creating…" : "Create package"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
