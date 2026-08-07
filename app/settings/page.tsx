"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { InfoTip } from "@/components/InfoTip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import api from "@/lib/api";

// ── Contract (from the backend handoff) ──────────────────────────────────────
// The path is stated relative to the axios base, which already carries
// `/api/v1/admin` (lib/api.ts). The handoff wrote "/admin/settings/allow-minors";
// with the base's `/admin` that would double up, so we use `/settings/...` here.
// If the backend's real path differs, THIS is the one line to change.
const ALLOW_MINORS_PATH = "/settings/allow-minors";

interface AllowMinorsSetting {
  allowMinors: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

type AdminRef = { id: string; name: string };

export default function SettingsPage() {
  const [setting, setSetting] = useState<AllowMinorsSetting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notBuilt, setNotBuilt] = useState(false);

  const [admins, setAdmins] = useState<AdminRef[]>([]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<AllowMinorsSetting>(ALLOW_MINORS_PATH)
      .then((r) => { setSetting(r.data); setError(null); setNotBuilt(false); })
      .catch((e) => {
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 404) setNotBuilt(true);
        else setError((e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message ?? (e as Error)?.message ?? "Couldn't load the setting.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Deferred a tick so the loading flag isn't set synchronously inside the
    // effect body (which cascades an extra render — same pattern the incidents/
    // feedback pages use).
    const t = setTimeout(() => {
      load();
      // Admin list resolves updatedBy (an admin id) into a name. Best-effort — if
      // it fails we just show the raw id.
      api.get<{ admins?: AdminRef[] }>("/auth/admins")
        .then((r) => setAdmins(r.data.admins ?? []))
        .catch(() => {});
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  // The value we would flip TO.
  const nextValue = setting ? !setting.allowMinors : null;

  async function applyChange() {
    if (savingRef.current || setting === null || nextValue === null) return;
    savingRef.current = true;
    setSaving(true);
    try {
      // No optimistic UI — the PUT response is the source of truth.
      const r = await api.put<AllowMinorsSetting>(ALLOW_MINORS_PATH, { allowMinors: nextValue });
      setSetting(r.data);
      setConfirmOpen(false);
      toast.success(
        r.data.allowMinors ? "Under-18 bookings are now ALLOWED." : "Under-18 bookings are now BLOCKED."
      );
    } catch (e) {
      toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "Couldn't update the setting.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function whoChanged(): string | null {
    if (!setting?.updatedBy) return null;
    return admins.find((a) => a.id === setting.updatedBy)?.name ?? setting.updatedBy;
  }

  return (
    <AdminLayout title="Settings">
      <div className="flex max-w-2xl flex-col gap-5">
        {loading ? (
          <Skeleton className="h-52" />
        ) : notBuilt ? (
          <div className="rounded-xl border border-border bg-card/60 p-6 text-center">
            <ShieldAlert size={24} className="mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm font-medium">This setting isn&apos;t available yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The backend for the under-18 toggle is being built. This page will work the moment it ships.
            </p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : setting ? (
          <div className="rounded-xl border border-border bg-card/60 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  Allow bookings for under-18 patients
                  <InfoTip label="When ON, patients under 18 can book. Bio-age isn't calibrated for minors and minors' health data carries extra legal weight — leave this OFF unless there's a deliberate reason. Takes effect across the fleet within ~30 seconds; no redeploy." />
                </span>
                <span className="text-xs text-muted-foreground">
                  {setting.allowMinors
                    ? "Under-18 patients CAN currently book."
                    : "Under-18 patients are currently BLOCKED from booking."}
                </span>
              </div>

              {/* State + toggle. No optimistic flip — the confirm dialog owns the change. */}
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                    setting.allowMinors
                      ? "bg-amber-500/20 text-amber-400"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {setting.allowMinors ? "ALLOWED" : "BLOCKED"}
                </span>
                <Button
                  size="sm"
                  variant={setting.allowMinors ? "outline" : "default"}
                  onClick={() => setConfirmOpen(true)}
                >
                  {setting.allowMinors ? "Block under-18 bookings" : "Allow under-18 bookings"}
                </Button>
              </div>
            </div>

            {(whoChanged() || setting.updatedAt) && (
              <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
                Last changed
                {whoChanged() ? <> by <span className="font-medium text-foreground">{whoChanged()}</span></> : null}
                {setting.updatedAt ? ` on ${new Date(setting.updatedAt).toLocaleString()}` : null}.
              </p>
            )}
          </div>
        ) : null}
      </div>

      {/* Confirm — this is medical/legal-sensitive; spell out the consequence. */}
      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!saving) setConfirmOpen(o); }}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-500" />
              {nextValue ? "Allow under-18 bookings?" : "Block under-18 bookings?"}
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground">
            {nextValue ? (
              <p>
                This lets patients <span className="font-medium text-foreground">under 18</span> book tests.
                Bio-age isn&apos;t calibrated for minors, and minors&apos; health data carries extra legal and
                consent obligations. It takes effect across the whole system within ~30 seconds.
              </p>
            ) : (
              <p>
                This stops all patients <span className="font-medium text-foreground">under 18</span> from
                booking. In-progress bookings aren&apos;t affected; new ones will be blocked within ~30 seconds.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={nextValue ? "default" : "destructive"}
              disabled={saving}
              onClick={() => void applyChange()}
            >
              {saving ? (
                <><Loader2 size={14} className="mr-2 animate-spin" />Saving…</>
              ) : nextValue ? (
                "Yes, allow under-18"
              ) : (
                "Yes, block under-18"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
