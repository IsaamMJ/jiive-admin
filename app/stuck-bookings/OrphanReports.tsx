"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, FileWarning, AlertTriangle, CheckCircle2, Clock, ExternalLink, Info,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  type OrphanReport, type OrphanReportList, type OrphanPreflight,
  type OrphanAdoptRequest, type OrphanAdoptResponse, type OrphanSubject,
  ORPHAN_DOB_RULE, isDeferredNotFailed,
} from "./types";

/**
 * Lab reports that arrived with no booking to attach to — orders placed directly
 * on the Thyrocare portal. The customer never got their result; the operator
 * supplies the missing identity and the backend builds the rows.
 *
 * Four safety rules are enforced here, and each one exists because of a specific
 * way a customer gets hurt:
 *  1. DOB is never prefilled from the vendor's `age` — bio-age is computed from
 *     the DOB, so a guessed year changes the customer's reported result.
 *  2. Adopt is unreachable until a dry-run has been previewed. A mistyped phone
 *     attaches a stranger's lab results to a real customer's account.
 *  3. `success:false` WITH a bookingId is a DEFERRAL, not a failure — shown
 *     neutrally, with no retry (re-posting would 409).
 *  4. `bioAgeReady:false` requires an explicit tick — adopting there sends the
 *     customer an apology instead of a result.
 *
 * Deliberately not built (per the contract): no dismiss (the list self-clears),
 * no bulk adopt (every row needs a human-typed DOB), no preflight polling (it
 * hits the vendor API).
 */
export function OrphanReports({ onLinked }: { onLinked: () => void }) {
  const [reports, setReports] = useState<OrphanReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<OrphanReport | null>(null);

  const load = useCallback(() => {
    return api
      .get<OrphanReportList>("/thyrocare/orphan-reports")
      .then((r) => setReports(r.data.reports ?? []))
      .catch(() => { /* silent — the section just stays hidden */ })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Render nothing at all when there's nothing stranded — this is an exception
  // queue, not a permanent fixture.
  if (loading || reports.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <FileWarning size={16} className="mt-0.5 shrink-0 text-amber-500" />
        <div>
          <h2 className="text-sm font-semibold">
            Unlinked lab reports ({reports.length})
          </h2>
          <p className="max-w-2xl text-xs text-muted-foreground">
            Results that arrived with no booking attached — almost always an order placed directly on
            the Thyrocare portal. These customers have <strong>not</strong> received their results.
            Open one and supply the customer&apos;s details to link it.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-amber-500/30">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order ID</TableHead>
              <TableHead>Lead ID</TableHead>
              <TableHead>Arrived</TableHead>
              <TableHead>Why it&apos;s stuck</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reports.map((r) => (
              <TableRow key={r.eventId}>
                <TableCell className="font-mono text-xs font-medium">{r.orderId}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {r.leadId ?? <span className="italic">not supplied</span>}
                </TableCell>
                <TableCell className="text-xs">
                  {new Date(r.receivedAt).toLocaleDateString()}{" "}
                  <span className="text-muted-foreground">
                    {new Date(r.receivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </TableCell>
                <TableCell className="max-w-sm truncate text-xs text-muted-foreground">
                  {r.error ?? "No booking matched this order"}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setOpen(r)}>
                    Link to customer
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AdoptDialog
        report={open}
        onClose={() => setOpen(null)}
        onLinked={() => { load(); onLinked(); }}
      />
    </div>
  );
}

// ── The adopt flow ───────────────────────────────────────────────────────────

function AdoptDialog({
  report, onClose, onLinked,
}: { report: OrphanReport | null; onClose: () => void; onLinked: () => void }) {
  const [pre, setPre] = useState<OrphanPreflight | null>(null);
  const [preLoading, setPreLoading] = useState(false);

  const [leadId, setLeadId] = useState("");
  const [phone, setPhone] = useState("");
  const [patientName, setPatientName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "">("");
  const [subject, setSubject] = useState<OrphanSubject>("self");
  const [relationship, setRelationship] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [pincode, setPincode] = useState("");

  const [bioAgeAck, setBioAgeAck] = useState(false);
  const [plan, setPlan] = useState<OrphanAdoptResponse | null>(null);
  const [reuseAck, setReuseAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<OrphanAdoptResponse | null>(null);

  // Preflight on open — once per row, never polled (it hits the vendor API).
  useEffect(() => {
    if (!report) return;
    setPre(null); setPlan(null); setDone(null); setBioAgeAck(false); setReuseAck(false);
    setLeadId(report.leadId ?? "");
    setPhone(""); setPatientName(""); setDob(""); setGender(""); setSubject("self");
    setRelationship(""); setCity(""); setState(""); setPincode("");
    setPreLoading(true);
    api
      .get<OrphanPreflight>(`/thyrocare/orphan-reports/${encodeURIComponent(report.orderId)}`)
      .then((r) => {
        setPre(r.data);
        if (!leadId && r.data.leadId) setLeadId(r.data.leadId);
        // Cosmetic fields only. NOT name, NOT gender, and above all NOT dob —
        // those must come from a document the operator is looking at.
        if (r.data.patientHint.city) setCity(r.data.patientHint.city);
        if (r.data.patientHint.state) setState(r.data.patientHint.state);
        if (r.data.patientHint.pincode) setPincode(String(r.data.patientHint.pincode));
      })
      .catch(() => toast.error("Could not check this report with Thyrocare."))
      .finally(() => setPreLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  // Any edit invalidates a previewed plan — otherwise you could preview a safe
  // phone number, change it, and adopt against the stale approval.
  function touched<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPlan(null); setReuseAck(false); };
  }

  const blockedReason =
    pre?.alreadyLinked ? "This report is already linked to a booking."
    : pre && !pre.reportAvailable ? "Thyrocare hasn't published this report yet."
    : null;

  const formComplete =
    leadId.trim() !== "" && phone.trim() !== "" && patientName.trim() !== "" &&
    dob.trim() !== "" && gender !== "" &&
    (subject !== "family_member" || relationship.trim() !== "");

  const bioAgeBlocked = !!pre && pre.reportAvailable && !pre.bioAgeReady && !bioAgeAck;
  const canPreview = !!pre && !blockedReason && formComplete && !bioAgeBlocked && !busy;
  // Rule 2: adopt is unreachable until a dry-run has been shown and, if it would
  // reuse an existing account, explicitly confirmed.
  const canAdopt = canPreview && !!plan && (!plan.reusedExistingUser || reuseAck);

  function body(dryRun: boolean): OrphanAdoptRequest {
    return {
      leadId: leadId.trim(),
      phone: phone.trim(),
      patientName: patientName.trim(),
      dob: dob.trim(),
      gender: gender as "male" | "female",
      subject,
      ...(subject === "family_member" ? { relationship: relationship.trim() } : {}),
      ...(city.trim() ? { city: city.trim() } : {}),
      ...(state.trim() ? { state: state.trim() } : {}),
      ...(pincode.trim() ? { pincode: Number(pincode.trim()) } : {}),
      notify: true,
      dryRun,
    };
  }

  async function run(dryRun: boolean, notify = true) {
    if (!report) return;
    setBusy(true);
    try {
      const payload = { ...body(dryRun), notify };
      const r = await api.post<OrphanAdoptResponse>(
        `/thyrocare/orphan-reports/${encodeURIComponent(report.orderId)}/adopt`, payload,
      );
      if (dryRun) {
        setPlan(r.data);
      } else {
        setDone(r.data);
        onLinked();
      }
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { message?: string; error?: string } } };
      if (e.response?.status === 409) {
        toast.info("Already linked — refreshing the list.");
        onLinked();
        onClose();
        return;
      }
      toast.error(e.response?.data?.message ?? e.response?.data?.error ?? "Could not link this report.");
    } finally {
      setBusy(false);
    }
  }

  const hint = pre?.patientHint;

  return (
    <Dialog open={report !== null} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">{report?.orderId}</DialogTitle>
          <DialogDescription>
            Link this lab report to the customer it belongs to.
          </DialogDescription>
        </DialogHeader>

        {preLoading && (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Checking with Thyrocare…
          </p>
        )}

        {/* ── Outcome ─────────────────────────────────────────────────────── */}
        {done ? (
          <AdoptOutcome result={done} onClose={onClose} />
        ) : pre && !preLoading ? (
          <div className="flex flex-col gap-4">
            {/* ── Preflight verdict ──────────────────────────────────────── */}
            {pre.alreadyLinked ? (
              <Banner tone="info" icon={<CheckCircle2 size={15} />} title="Already linked">
                Someone has already linked this report.
                {pre.linkedBookingId && (
                  <> Booking <span className="font-mono">{pre.linkedBookingId.slice(0, 8)}…</span>.</>
                )}
              </Banner>
            ) : !pre.reportAvailable ? (
              <Banner tone="info" icon={<Clock size={15} />} title="Report not ready yet">
                Thyrocare hasn&apos;t published this report. This is normal soon after collection —
                check back later. Nothing to do now.
              </Banner>
            ) : !pre.bioAgeReady ? (
              <Banner tone="warn" icon={<AlertTriangle size={15} />} title="Bio-age can't be calculated from this report">
                <p>
                  {pre.biomarkerCount} biomarkers came back, but the ones needed for bio-age are missing
                  — usually because a non-bio-age package was ordered.
                </p>
                {pre.markersMissing.length > 0 && (
                  <p className="mt-1 font-mono text-[11px]">Missing: {pre.markersMissing.join(", ")}</p>
                )}
                <p className="mt-1.5 font-medium">
                  If you link it, the customer gets an apology message instead of a result.
                </p>
                <label className="mt-2 flex items-start gap-2 text-xs font-medium">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 accent-amber-500"
                    checked={bioAgeAck}
                    onChange={(e) => setBioAgeAck(e.target.checked)}
                  />
                  I understand this sends an apology, not a result.
                </label>
              </Banner>
            ) : (
              <Banner tone="ok" icon={<CheckCircle2 size={15} />} title="Report ready">
                {pre.biomarkerCount} biomarkers, bio-age can be calculated.
              </Banner>
            )}

            {pre.vendorLookupError && (
              <Banner tone="warn" icon={<Info size={15} />} title="Couldn't load patient details from Thyrocare">
                You&apos;ll need to get the customer&apos;s details from another source. The report itself is
                unaffected.
              </Banner>
            )}

            {!pre.alreadyLinked && pre.reportAvailable && (
              <>
                {/* ── Identity form + vendor hint side by side ───────────── */}
                <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
                  <div className="flex flex-col gap-3">
                    <Field label="Lead ID" required>
                      <Input value={leadId} onChange={(e) => touched(setLeadId)(e.target.value)} className="font-mono text-sm" />
                    </Field>
                    <Field label="WhatsApp number" required hint="Any format — this is who receives the result.">
                      <Input value={phone} onChange={(e) => touched(setPhone)(e.target.value)} placeholder="+91 99999 12345" />
                    </Field>
                    <Field label="Patient name" required>
                      <Input value={patientName} onChange={(e) => touched(setPatientName)(e.target.value)} />
                    </Field>
                    <Field label="Date of birth" required hint={ORPHAN_DOB_RULE}>
                      <Input type="date" value={dob} onChange={(e) => touched(setDob)(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
                    </Field>
                    <Field label="Gender" required>
                      <Select value={gender} onValueChange={(v) => touched(setGender)((v ?? "") as "male" | "female" | "")}>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="male">Male</SelectItem>
                          <SelectItem value="female">Female</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Whose number is this?" required>
                      <Select value={subject} onValueChange={(v) => touched(setSubject)((v ?? "self") as OrphanSubject)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="self">The person who was tested</SelectItem>
                          <SelectItem value="family_member">Someone else — tested person is their family</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {subject === "self"
                          ? "The result becomes this account holder's own."
                          : "The result is filed under this account as a family member."}
                      </p>
                    </Field>
                    {subject === "family_member" && (
                      <Field label="Relationship to the account holder" required>
                        <Input value={relationship} onChange={(e) => touched(setRelationship)(e.target.value)} placeholder="mother, cousin…" />
                      </Field>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                      <Field label="City"><Input value={city} onChange={(e) => touched(setCity)(e.target.value)} /></Field>
                      <Field label="State"><Input value={state} onChange={(e) => touched(setState)(e.target.value)} /></Field>
                      <Field label="Pincode"><Input value={pincode} onChange={(e) => touched(setPincode)(e.target.value)} inputMode="numeric" /></Field>
                    </div>
                  </div>

                  {/* Compare-against panel. Never a source of prefill for identity. */}
                  <div className="h-fit rounded-lg border border-border bg-muted/40 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Thyrocare says
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Compare — don&apos;t copy blindly.
                    </p>
                    <dl className="mt-2 space-y-1 text-[11px]">
                      <HintRow k="Name" v={hint?.name} />
                      <HintRow k="Age" v={hint?.age != null ? `${hint.age}` : null} warn />
                      <HintRow k="Gender" v={hint?.gender} />
                      <HintRow k="City" v={hint?.city} />
                      <HintRow k="Collected" v={hint?.collectionDate} />
                    </dl>
                    {hint?.age != null && (
                      <p className="mt-2 border-t border-border pt-2 text-[11px] text-amber-600 dark:text-amber-400">
                        Don&apos;t turn this age into a date of birth — it would change their bio-age.
                      </p>
                    )}
                  </div>
                </div>

                {/* ── The dry-run plan ───────────────────────────────────── */}
                {plan && (
                  <div
                    className={cn(
                      "rounded-lg border p-3",
                      plan.reusedExistingUser
                        ? "border-amber-500/40 bg-amber-500/10"
                        : "border-border bg-muted/40",
                    )}
                  >
                    <p className="text-xs font-semibold">
                      {plan.reusedExistingUser
                        ? "This will attach to an EXISTING account"
                        : "This will create a new customer account"}
                    </p>
                    {plan.reusedExistingUser ? (
                      <>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {phone.trim()} already belongs to{" "}
                          <strong className="text-foreground">
                            {plan.existingUser?.name?.trim() || "an existing customer"}
                          </strong>
                          . If that isn&apos;t the person who was tested, stop — you would be filing
                          someone else&apos;s lab results under their account.
                        </p>
                        <label className="mt-2 flex items-start gap-2 text-xs font-medium">
                          <input
                            type="checkbox"
                            className="mt-0.5 h-3.5 w-3.5 accent-amber-500"
                            checked={reuseAck}
                            onChange={(e) => setReuseAck(e.target.checked)}
                          />
                          I&apos;ve checked — this is the right person.
                        </label>
                      </>
                    ) : (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        No account exists for {phone.trim()} yet, so a new one will be created.
                      </p>
                    )}
                  </div>
                )}

                {/* ── Actions ───────────────────────────────────────────── */}
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <Button variant="outline" size="sm" disabled={!canPreview} onClick={() => run(true)}>
                    {busy && !plan ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : null}
                    Preview
                  </Button>
                  <Button size="sm" disabled={!canAdopt} onClick={() => run(false, true)}>
                    {busy && plan ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : null}
                    Link &amp; send results
                  </Button>
                  <Button variant="ghost" size="sm" disabled={!canAdopt} onClick={() => run(false, false)}>
                    Link quietly
                  </Button>
                  {!plan && (
                    <span className="text-[11px] text-muted-foreground">
                      Preview first — it shows whether this creates a new account or uses an existing one.
                    </span>
                  )}
                </div>
                <p className="-mt-1 text-[11px] text-muted-foreground">
                  <strong>Link &amp; send results</strong> messages the customer on WhatsApp straight away.{" "}
                  <strong>Link quietly</strong> creates everything but sends nothing.
                </p>
              </>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Rule 3 lives here: a deferral is reported as progress, never as a red failure. */
function AdoptOutcome({ result, onClose }: { result: OrphanAdoptResponse; onClose: () => void }) {
  const deferred = isDeferredNotFailed(result);
  const ok = result.success;

  return (
    <div className="flex flex-col gap-3">
      {ok ? (
        <Banner tone="ok" icon={<CheckCircle2 size={15} />} title="Linked">
          The report is attached to the customer.
          {result.notified ? " They've been messaged on WhatsApp." : " No message was sent."}
        </Banner>
      ) : deferred ? (
        <Banner tone="info" icon={<Clock size={15} />} title="Linked — results still processing">
          <p>
            The booking was created and the order is attached, so this row is handled. The results
            aren&apos;t finished yet; the system completes them automatically within about 30 minutes.
          </p>
          <p className="mt-1">Nothing more to do — don&apos;t link it again.</p>
        </Banner>
      ) : (
        <Banner tone="warn" icon={<AlertTriangle size={15} />} title="Couldn't complete">
          {result.pipelineError ?? "The report could not be linked."}
        </Banner>
      )}

      {(ok || deferred) && (
        <div className="flex flex-wrap gap-2 text-xs">
          {result.bookingId && (
            <Link href="/bookings" className="inline-flex items-center gap-1 text-primary hover:underline">
              <ExternalLink size={12} /> Bookings
            </Link>
          )}
          {result.resultId && (
            <Link href={`/results/${result.resultId}`} className="inline-flex items-center gap-1 text-primary hover:underline">
              <ExternalLink size={12} /> View result
            </Link>
          )}
          {result.userId && (
            <Link href={`/users/${result.userId}`} className="inline-flex items-center gap-1 text-primary hover:underline">
              <ExternalLink size={12} /> Customer
            </Link>
          )}
        </div>
      )}

      <div className="border-t border-border pt-3">
        <Button size="sm" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}

// ── Small presentational helpers ─────────────────────────────────────────────

function Banner({
  tone, icon, title, children,
}: { tone: "ok" | "warn" | "info"; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  const cls = {
    ok: "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400",
    warn: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    info: "border-border bg-muted/50 text-foreground",
  }[tone];
  return (
    <div className={cn("rounded-lg border p-3", cls)}>
      <p className="flex items-center gap-1.5 text-xs font-semibold">{icon}{title}</p>
      <div className="mt-1 text-[11px] text-muted-foreground">{children}</div>
    </div>
  );
}

function Field({
  label, required, hint, children,
}: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs">
        {label}{required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function HintRow({ k, v, warn }: { k: string; v?: string | null; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={cn("text-right", warn && v ? "text-amber-600 dark:text-amber-400" : "")}>
        {v?.toString().trim() || <span className="text-muted-foreground/60">—</span>}
      </dd>
    </div>
  );
}
