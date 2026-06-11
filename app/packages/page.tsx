"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Check, X, Pencil } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

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
        <p className="text-sm text-muted-foreground">
          Customer-facing price for each bookable Thyrocare package. Editing a price affects new bookings only — existing bookings keep their captured amount.
        </p>

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
                        <Badge variant={p.isActive ? "default" : "secondary"}>{p.isActive ? "Active" : "Inactive"}</Badge>
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
    </AdminLayout>
  );
}
