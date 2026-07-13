"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Plus, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { InfoTip } from "@/components/InfoTip";
import { cn } from "@/lib/utils";
import {
  createActionItem,
  incidentErrorMessage,
  listAdmins,
  updateActionItem,
  updateIncident,
} from "../api";
import {
  enumLabel,
  RCA_REQUIRED_SEVERITIES,
  VENDOR_LABEL,
  type CreateActionItemRequest,
  type IncidentDetail,
  type IncidentVendor,
} from "../types";
import { formatDate, todayLocalDate } from "../lib/datetime";
import { useIncidentMeta } from "../lib/useIncidentMeta";

interface Props {
  incident: IncidentDetail;
  onUpdated: (detail: IncidentDetail) => void;
}

/** "No vendor owes this" — the default for the optional vendor field. */
const NO_VENDOR = "none";

export function IncidentRcaBlock({ incident, onUpdated }: Props) {
  const { meta } = useIncidentMeta();
  // "Who owes the deliverable" is a real vendor, never "none" — that option is the
  // absence of a vendor, and it is already the default.
  const vendorOptions = meta.vendors.filter((v) => v.value !== "none");

  const [admins, setAdmins] = useState<Array<{ id: string; name: string }>>([]);
  const [adminsError, setAdminsError] = useState(false);

  const [factor, setFactor] = useState("");
  const [savingFactor, setSavingFactor] = useState(false);
  const factorRef = useRef(false);

  const [desc, setDesc] = useState("");
  const [owner, setOwner] = useState("");
  const [vendorOwes, setVendorOwes] = useState<string>(NO_VENDOR);
  const [dueDate, setDueDate] = useState("");
  const [savingAction, setSavingAction] = useState(false);
  const actionRef = useRef(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    listAdmins()
      .then((a) => setAdmins(a.map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => setAdminsError(true));
  }, []);

  const rcaOwed = incident.rcaOwed;
  const rcaRequired = RCA_REQUIRED_SEVERITIES.includes(incident.severity);

  async function saveFactors(next: string[]) {
    if (factorRef.current) return;
    factorRef.current = true;
    setSavingFactor(true);
    try {
      onUpdated(await updateIncident(incident.id, { contributingFactors: next }));
      setFactor("");
    } catch (err: unknown) {
      toast.error(incidentErrorMessage(err));
    } finally {
      factorRef.current = false;
      setSavingFactor(false);
    }
  }

  const actionDisabledReason: string | null =
    desc.trim() === ""
      ? "Describe the action."
      : owner === ""
      ? "Every action needs an internal owner — someone here who chases it."
      : dueDate === ""
      ? "Every action needs a due date."
      : null;

  async function addAction() {
    if (actionDisabledReason) return;
    if (actionRef.current) return;
    actionRef.current = true;
    setSavingAction(true);
    try {
      // ownerAdminId is always sent (Round 2 R2). ownerVendor only records who
      // OWES the deliverable — it never substitutes for the internal owner.
      const body: CreateActionItemRequest = {
        description: desc.trim(),
        ownerAdminId: owner,
        dueDate,
      };
      if (vendorOwes !== NO_VENDOR) body.ownerVendor = vendorOwes as IncidentVendor;
      onUpdated(await createActionItem(incident.id, body));
      setDesc("");
      setOwner("");
      setVendorOwes(NO_VENDOR);
      setDueDate("");
      toast.success("Action item added.");
    } catch (err: unknown) {
      toast.error(incidentErrorMessage(err));
    } finally {
      actionRef.current = false;
      setSavingAction(false);
    }
  }

  async function toggleDone(actionId: string, done: boolean) {
    if (togglingId) return;
    setTogglingId(actionId);
    try {
      onUpdated(await updateActionItem(incident.id, actionId, { doneAt: done ? new Date().toISOString() : null }));
    } catch (err: unknown) {
      toast.error(incidentErrorMessage(err));
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <Card className={cn(rcaOwed && "border-amber-500/40")}>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-1.5 text-base">
          Root-cause analysis
          <InfoTip label="Written once the customer is whole again. It is the reason RESOLVED and CLOSED are separate: close the record the moment the customer is fine and nobody ever writes down why it happened." />
          {rcaOwed && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
              Owed
            </span>
          )}
        </CardTitle>
        {rcaRequired && incident.status === "OPEN" && (
          <p className="text-xs text-muted-foreground">
            An {incident.severity} incident owes an RCA once it is resolved. You can start writing it now.
          </p>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {/* Contributing factors — plural, deliberately. */}
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            Contributing factors
            <InfoTip label="Plural on purpose. There is rarely one root cause — June 21 had at least three: an incomplete address, a booking model that turned six panels into six orders, and a vendor who never dispatched. A single “root cause” field would force you to pick one and lose the rest." />
          </span>

          {incident.contributingFactors.length === 0 ? (
            <p className="text-sm text-muted-foreground">None written yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {incident.contributingFactors.map((f, idx) => (
                <li
                  key={`${f}-${idx}`}
                  className="flex items-start gap-2 rounded-lg border border-border bg-card/60 px-3 py-2"
                >
                  <span className="flex-1 break-words text-sm">{f}</span>
                  <button
                    type="button"
                    aria-label="Remove factor"
                    disabled={savingFactor}
                    onClick={() => saveFactors(incident.contributingFactors.filter((_, i) => i !== idx))}
                    className="mt-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={factor}
              onChange={(e) => setFactor(e.target.value)}
              disabled={savingFactor}
              placeholder="e.g. Incomplete address reached a live order"
              className="flex-1 text-base sm:text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && factor.trim() !== "" && !savingFactor) {
                  saveFactors([...incident.contributingFactors, factor.trim()]);
                }
              }}
            />
            <Button
              variant="outline"
              disabled={savingFactor || factor.trim() === ""}
              title={factor.trim() === "" ? "Write a factor first." : undefined}
              onClick={() => saveFactors([...incident.contributingFactors, factor.trim()])}
              className="min-h-9"
            >
              {savingFactor ? <Loader2 size={14} className="animate-spin" /> : <><Plus size={14} className="mr-1.5" />Add factor</>}
            </Button>
          </div>
        </div>

        {/* Action items — owner and due date both required. */}
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            Action items
            <InfoTip label="An internal owner and a due date are both required — actions without them never get done. If Thyrocare owes the deliverable, record that separately: someone here still has to chase it. June 21 failed precisely because the RCA's only owner was the vendor and nobody internal owned chasing it." />
          </span>

          {incident.actionItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">No action items yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {incident.actionItems.map((a) => {
                const done = a.doneAt !== null;
                return (
                  <li
                    key={a.id}
                    className={cn(
                      "flex flex-col gap-1.5 rounded-lg border px-3 py-2 sm:flex-row sm:items-center sm:justify-between",
                      done
                        ? "border-border bg-card/40 opacity-70"
                        : a.overdue
                        ? "border-red-500/40 bg-red-500/5"
                        : "border-border bg-card/60"
                    )}
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className={cn("break-words text-sm", done && "line-through")}>{a.description}</span>
                      {/* The vendor OWES it; the admin CHASES it. Never let the
                          vendor read as the owner — an action item owned only by
                          Thyrocare is an action item with no owner at all. */}
                      <span className="flex flex-wrap items-center gap-x-3 text-xs">
                        {a.ownerVendor && a.ownerVendor !== "none" && (
                          <span className="text-muted-foreground">
                            Owed by{" "}
                            <span className="font-medium text-foreground">
                              {enumLabel(VENDOR_LABEL, a.ownerVendor)}
                            </span>
                          </span>
                        )}
                        <span className="text-muted-foreground">
                          Chased by <span className="font-medium text-foreground">{a.ownerLabel}</span>
                        </span>
                        <span className={cn(!done && a.overdue ? "font-semibold text-red-400" : "text-muted-foreground")}>
                          Due {formatDate(a.dueDate)}
                          {!done && a.overdue ? " · overdue" : ""}
                        </span>
                        {done && <span className="text-emerald-400">Done</span>}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={togglingId !== null}
                      onClick={() => toggleDone(a.id, !done)}
                      className="min-h-9 shrink-0"
                    >
                      {togglingId === a.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : done ? (
                        <><RotateCcw size={14} className="mr-1.5" />Re-open</>
                      ) : (
                        <><Check size={14} className="mr-1.5" />Mark done</>
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-col gap-2 rounded-xl border border-border bg-card/40 p-3">
            <Input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              disabled={savingAction}
              placeholder="e.g. Thyrocare written RCA on the 21 Jun no-show"
              className="text-base sm:text-sm"
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select value={owner} onValueChange={(v) => setOwner(v ?? "")} disabled={savingAction}>
                <SelectTrigger className="w-full sm:w-52">
                  <SelectValue placeholder={adminsError ? "Couldn't load admins" : "Owner (required)"} />
                </SelectTrigger>
                <SelectContent>
                  {admins.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={vendorOwes}
                onValueChange={(v) => setVendorOwes(v ?? NO_VENDOR)}
                disabled={savingAction}
              >
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_VENDOR}>No vendor owes this</SelectItem>
                  {vendorOptions.map((v) => (
                    <SelectItem key={v.value} value={v.value}>{v.label} owes it</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                type="date"
                aria-label="Due date"
                value={dueDate}
                min={todayLocalDate()}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={savingAction}
                className="w-full text-base sm:w-44 sm:text-sm"
              />

              <div className="flex flex-1 items-center justify-end gap-2">
                {actionDisabledReason && (desc !== "" || owner !== "" || dueDate !== "") && (
                  <span className="text-xs text-muted-foreground">{actionDisabledReason}</span>
                )}
                <Button
                  onClick={addAction}
                  disabled={savingAction || actionDisabledReason !== null}
                  title={actionDisabledReason ?? undefined}
                  className="min-h-9"
                >
                  {savingAction ? (
                    <><Loader2 size={14} className="mr-2 animate-spin" />Adding…</>
                  ) : (
                    <><Plus size={14} className="mr-1.5" />Add action</>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
