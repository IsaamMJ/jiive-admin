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
import { InfoTip } from "@/components/InfoTip";
import { cn } from "@/lib/utils";
import {
  type OrphanReport, type OrphanReportList, type OrphanPreflight,
  type OrphanAdoptRequest, type OrphanAdoptResponse, type OrphanSubject,
  type OrphanReportDiagnostic,
  ORPHAN_DOB_RULE, isDeferredNotFailed, collectionDateFromHint, checkPhone,
  classifyReportFetchFailure, patientsThyrocareSaysAreReady, rosterContradictsFetchFailure,
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
  const [peopleWaiting, setPeopleWaiting] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<OrphanReport | null>(null);

  const load = useCallback(() => {
    return api
      .get<OrphanReportList>("/thyrocare/orphan-reports")
      .then((r) => {
        setReports(r.data.reports ?? []);
        // People, not orders — one order can hold two of them.
        setPeopleWaiting(r.data.peopleWaiting ?? null);
      })
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
            Unlinked lab reports —{" "}
            {peopleWaiting != null
              ? `${peopleWaiting} ${peopleWaiting === 1 ? "person" : "people"} waiting`
              : `${reports.length} ${reports.length === 1 ? "order" : "orders"}`}
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
              <TableHead>Still waiting</TableHead>
              <TableHead>Arrived</TableHead>
              <TableHead>Why it&apos;s stuck</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reports.map((r) => (
              <TableRow key={r.eventId}>
                <TableCell className="font-mono text-xs font-medium">{r.orderId}</TableCell>
                {/* Who is still owed, never the row's own leadId — on a partly
                    adopted order that's the person already DONE. */}
                <TableCell className="text-xs">
                  {r.unadoptedPatients && r.unadoptedPatients.length > 0 ? (
                    <div className="flex flex-col gap-0.5">
                      {r.unadoptedPatients.map((p) => (
                        <span key={p.leadId}>
                          {p.name ?? "Unnamed"}{" "}
                          <span className="font-mono text-[10px] text-muted-foreground">{p.leadId}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    // null = unresolved, not one and not none. Never print "null",
                    // never imply zero — someone is waiting either way.
                    <span className="text-muted-foreground">
                      {r.patientsWaiting == null
                        ? "1+ waiting"
                        : `${r.patientsWaiting} waiting`}
                    </span>
                  )}
                  {r.multiPatient && (
                    <span className="ml-1 rounded bg-amber-500/20 px-1 text-[10px] text-amber-600 dark:text-amber-400">
                      multi
                    </span>
                  )}
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
  /**
   * Which person on the order we're linking. An order can cover several people,
   * each with their own lead and report, so every field below belongs to THIS
   * patient — never to the order as a whole.
   */
  const [selectedLead, setSelectedLead] = useState<string | null>(null);

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

  // Preflight fetch, reusable so an our-side failure can be retried on demand.
  // Still never polled — it costs two live vendor calls.
  const runPreflight = useCallback((r: OrphanReport) => {
    setPreLoading(true);
    return api
      .get<OrphanPreflight>(`/thyrocare/orphan-reports/${encodeURIComponent(r.orderId)}`)
      .then((resp) => {
        setPre(resp.data);
        // Auto-select only when there is genuinely one person to link. With
        // several, the operator must choose — picking for them is how the wrong
        // patient's details get filed.
        const list = resp.data.patients ?? [];
        const pending = list.filter((p) => !p.adopted);
        setSelectedLead(
          list.length <= 1 ? (list[0]?.leadId ?? resp.data.leadId ?? null)
          : pending.length === 1 ? pending[0].leadId
          : null,
        );
        // Seed the lead ONLY when there is no roster. With one, the lead must
        // come from the chosen patient — the order-level lead is the webhook's,
        // which on a partially-adopted order is the person already done.
        if (list.length === 0 && resp.data.leadId) setLeadId((cur) => cur || resp.data.leadId || "");
        // Cosmetic fields only. NOT name, NOT gender, and above all NOT dob —
        // those must come from a document the operator is looking at.
        if (resp.data.patientHint.city) setCity(resp.data.patientHint.city);
        if (resp.data.patientHint.state) setState(resp.data.patientHint.state);
        if (resp.data.patientHint.pincode) setPincode(String(resp.data.patientHint.pincode));
      })
      .catch(() => toast.error("Could not check this report with Thyrocare."))
      .finally(() => setPreLoading(false));
  }, []);

  const onRetryPreflight = useCallback(() => { if (report) runPreflight(report); }, [report, runPreflight]);

  // Preflight on open — once per row, never polled (it hits the vendor API).
  useEffect(() => {
    if (!report) return;
    setPre(null); setPlan(null); setDone(null); setBioAgeAck(false); setReuseAck(false);
    setLeadId(""); // never the row lead — see OrphanReport.leadId
    setPhone(""); setPatientName(""); setDob(""); setGender(""); setSubject("self");
    setRelationship(""); setCity(""); setState(""); setPincode("");
    runPreflight(report);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  // Any edit invalidates a previewed plan — otherwise you could preview a safe
  // phone number, change it, and adopt against the stale approval.
  function touched<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPlan(null); setReuseAck(false); };
  }

  const patients = pre?.patients ?? [];
  const multi = !!pre?.multiPatient && patients.length > 1;
  const selected = patients.find((p) => p.leadId === selectedLead) ?? null;
  const unadopted = patients.filter((p) => !p.adopted);
  /**
   * The lead we actually adopt with. When a roster exists it comes from the
   * CHOSEN patient and is never typed — it is already known, and hand-typing a
   * lead that differs from a sibling's by one digit is how the wrong person's
   * blood gets filed. The free-text field survives only for legacy payloads that
   * carry no roster at all.
   */
  const effectiveLeadId = selected?.leadId ?? leadId;
  /**
   * Resolve the phone to what WhatsApp will actually match on. A bare 10-digit
   * number would otherwise become a second account she never sees.
   */
  const phoneCheck = checkPhone(phone);

  /** Switch patient — wipes every identity field so nothing carries across. */
  function choosePatient(leadIdValue: string) {
    setSelectedLead(leadIdValue);
    setLeadId(leadIdValue);
    setPhone(""); setPatientName(""); setDob(""); setGender("");
    setSubject("self"); setRelationship("");
    setPlan(null); setReuseAck(false); setBioAgeAck(false);
  }

  /**
   * `alreadyLinked` answers for the lead the WEBHOOK carried — on a partially
   * adopted order that's the person already DONE. Judging the order by it hides
   * the form from the person still owed a result. When a roster exists, the only
   * honest question is whether THIS patient is adopted.
   */
  const nothingLeftToDo = patients.length > 0
    ? unadopted.length === 0
    : !!pre?.alreadyLinked;

  /**
   * What Thyrocare actually told us when the report fetch failed. Read the
   * evidence block above classifyReportFetchFailure() before changing anything
   * below — the old code read `ourSide` (whose leg failed) as if it answered
   * "does this order exist", and told an operator that a real, waiting customer
   * had never existed.
   */
  const fetchVerdict = classifyReportFetchFailure(pre?.reportDiagnostic);
  /**
   * Thyrocare's OWN roster for this order, saying these people have a report
   * waiting. A positive statement, and more specific than the order-level fetch
   * that failed — so on VLC5D31A it outranks the 500.
   */
  const rosterReady = patientsThyrocareSaysAreReady(pre);
  const rosterContradicts = rosterContradictsFetchFailure(pre);

  /**
   * Why there is no form. We refuse ONLY on a positive signal that there is
   * nothing to do — everyone adopted, or Thyrocare stating it holds no such
   * order. A failed fetch is not such a signal: it means we don't know, and
   * "don't know" must not look like "no".
   *
   * The unblocking condition is likewise positive: the roster naming an
   * unadopted patient whose report IS available. We never open the form on the
   * mere absence of a "no" — an absent signal is never a positive assurance.
   *
   * Opening the form does NOT weaken anything: adopt stays unreachable until a
   * dry run has been previewed (canAdopt requires `plan`), and the dry run is
   * the real gate. The point is to let the operator REACH it.
   */
  const blockedReason =
    nothingLeftToDo ? "Everyone on this order is already linked."
    : pre && !pre.reportAvailable && rosterReady.length === 0
      ? fetchVerdict.kind === "vendor_says_no_report"
        ? "Thyrocare says it holds no such order, so there is no report to link."
        : fetchVerdict.kind === "not_published_yet"
          ? "Thyrocare hasn't published this report yet."
          : "We couldn't read this report from Thyrocare — try again above. Nothing here says the report is missing."
    : null;

  const formComplete =
    effectiveLeadId.trim() !== "" && phoneCheck.ok && patientName.trim() !== "" &&
    dob.trim() !== "" && gender !== "" &&
    (subject !== "family_member" || relationship.trim() !== "");

  const bioAgeBlocked = !!pre && pre.reportAvailable && !pre.bioAgeReady && !bioAgeAck;
  const canPreview = !!pre && !blockedReason && formComplete && !bioAgeBlocked && !busy;
  // Rule 2: adopt is unreachable until a dry-run has been shown and, if it would
  // reuse an existing account, explicitly confirmed.
  const canAdopt = canPreview && !!plan && (!plan.reusedExistingUser || reuseAck);

  function body(dryRun: boolean): OrphanAdoptRequest {
    return {
      leadId: effectiveLeadId.trim(),
      phone: phoneCheck.canonical,
      patientName: patientName.trim(),
      dob: dob.trim(),
      gender: gender as "male" | "female",
      subject,
      ...(subject === "family_member" ? { relationship: relationship.trim() } : {}),
      ...(city.trim() ? { city: city.trim() } : {}),
      ...(state.trim() ? { state: state.trim() } : {}),
      ...(pincode.trim() ? { pincode: Number(pincode.trim()) } : {}),
      // The real draw date. Omitted, the booking is dated today and looks like an
      // abandoned same-day appointment — that fired a false no-show page live.
      ...(collectionDateFromHint(pre?.patientHint.collectionDate)
        ? { collectionDate: collectionDateFromHint(pre?.patientHint.collectionDate) }
        : {}),
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
          <AdoptOutcome
            result={done}
            onClose={onClose}
            onAdoptNext={(lead) => { setDone(null); choosePatient(lead); if (report) runPreflight(report); }}
          />
        ) : pre && !preLoading ? (
          <div className="flex flex-col gap-4">
            {/* ── Preflight verdict ──────────────────────────────────────── */}
            {nothingLeftToDo ? (
              <Banner tone="info" icon={<CheckCircle2 size={15} />} title="Already linked">
                Someone has already linked this report.
                {pre.linkedBookingId && (
                  <> Booking <span className="font-mono">{pre.linkedBookingId.slice(0, 8)}…</span>.</>
                )}
              </Banner>
            ) : !pre.reportAvailable ? (
              // Three outcomes, not two. `ourSide` says WHOSE LEG FAILED — it
              // never said whether the order exists, and reading it that way is
              // what told an operator that Juveira A H (VLC5D31A) had never
              // existed while her report sat at Thyrocare. The verdict now comes
              // from what Thyrocare actually said; see types.ts.
              <>
                {fetchVerdict.kind === "vendor_says_no_report" ? (
                  // The ONLY branch allowed to suggest the order never existed —
                  // gated on mayNeverHaveExisted, which needs Thyrocare's own
                  // words (DATA_NOT_FOUND), not merely a failure.
                  <Banner tone="info" icon={<Info size={15} />} title="Thyrocare has no report for this order">
                    <p>
                      They answered
                      {pre.reportDiagnostic?.httpStatus ? ` (${pre.reportDiagnostic.httpStatus})` : ""} and
                      said they hold no such order. That&apos;s an answer, not a connection problem, so
                      retrying gives the same one. Usually a demo or mistyped order that never existed at
                      Thyrocare.
                    </p>
                    <VendorSaid diag={pre.reportDiagnostic} />
                  </Banner>
                ) : fetchVerdict.kind === "not_published_yet" ? (
                  <Banner tone="info" icon={<Clock size={15} />} title="Report not ready yet">
                    Thyrocare hasn&apos;t published this report. Normal soon after collection — check back
                    later. Nothing to do now.
                  </Banner>
                ) : (
                  // Our leg failed, their leg failed transiently, or we couldn't
                  // tell. All three mean the same thing to the operator: we do
                  // NOT know that the report is missing, and a re-read is the
                  // right next move. Note the retry survives the backend sending
                  // retryable:false — it did exactly that on VLC5D31A.
                  <Banner
                    tone="warn"
                    icon={<AlertTriangle size={15} />}
                    title={
                      fetchVerdict.kind === "our_request_failed"
                        ? "We couldn't fetch the report"
                        : fetchVerdict.kind === "vendor_transient"
                          ? "Thyrocare's system is having trouble"
                          : "We couldn't tell why the report didn't load"
                    }
                  >
                    <p>
                      {fetchVerdict.kind === "our_request_failed" ? (
                        <>
                          The request to Thyrocare failed on our side
                          {pre.reportDiagnostic?.kind
                            ? ` (${pre.reportDiagnostic.kind.replace(/_/g, " ")})`
                            : ""}
                          . The report may well be fine — this is worth retrying.
                        </>
                      ) : fetchVerdict.kind === "vendor_transient" ? (
                        <>
                          Their server answered, but only to say it timed out or is overloaded.{" "}
                          <strong>Nothing here says this order or report is missing</strong> — it&apos;s
                          their system, not this customer. Retrying is exactly the right move and often
                          works within a minute.
                        </>
                      ) : (
                        <>
                          Thyrocare&apos;s answer didn&apos;t explain itself, and we won&apos;t guess.{" "}
                          <strong>This does not mean the report is missing.</strong> Try again — if it
                          keeps failing, escalate rather than assuming the order is bad.
                        </>
                      )}
                    </p>
                    <VendorSaid diag={pre.reportDiagnostic} />
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Button size="sm" variant="outline" disabled={preLoading} onClick={onRetryPreflight}>
                        {preLoading ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : null}
                        Try again
                      </Button>
                      <InfoTip label="Re-asks Thyrocare for this report right now. It only reads — nothing is created and nothing is sent to the customer. It costs a live call to their API, which is why it isn't retried automatically on a timer." />
                    </div>
                  </Banner>
                )}

                {/* The payload contradicting itself is the finding, so say it out
                    loud rather than letting the order-level failure speak for the
                    whole order. VLC5D31A: the fetch 500'd, while Thyrocare's own
                    roster for that same order marked Juveira A H's report
                    available. The roster is per-patient and is a positive
                    statement — it wins. */}
                {rosterContradicts && (
                  <Banner
                    tone="warn"
                    icon={<AlertTriangle size={15} />}
                    title="But Thyrocare's own patient list says the report IS there"
                  >
                    <p>
                      The order-level fetch failed, yet the patient list Thyrocare returned for this same
                      order marks{" "}
                      <strong className="text-foreground">
                        {rosterReady.map((p) => p.name ?? p.leadId).join(", ")}
                      </strong>{" "}
                      as having a report available. So this is a <strong>fetch problem, not a missing
                      report</strong> — {rosterReady.length === 1 ? "this person is" : "these people are"}{" "}
                      real and still waiting.
                      <span className="ml-1 inline-flex translate-y-0.5">
                        <InfoTip label="Two separate answers come back about one order: a fetch for the report itself, and a list of the people on the order. Here the first failed and the second succeeded. The list is the more specific of the two, so when it says a report exists, treat the failure as a fetch problem." />
                      </span>
                    </p>
                    <p className="mt-1">
                      Try again first. If it keeps failing you can still fill the form below — Preview
                      will refuse if the link genuinely can&apos;t go through.
                    </p>
                  </Banner>
                )}
              </>
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

            {/* This order covers several people. Each is a separate customer with
                their own report — an operator must never leave thinking they're
                done while someone here still has no result. */}
            {multi && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                  This order covers {patients.length} people — each needs linking separately
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {unadopted.length === 0
                    ? "All of them are linked. Nothing left to do here."
                    : `${unadopted.length} still ${unadopted.length === 1 ? "has" : "have"} no result.`}
                </p>
                <div className="mt-2 flex flex-col gap-1.5">
                  {patients.map((p) => {
                    const active = p.leadId === selectedLead;
                    return (
                      <button
                        key={p.leadId}
                        type="button"
                        disabled={p.adopted}
                        onClick={() => choosePatient(p.leadId)}
                        className={cn(
                          "flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors",
                          p.adopted
                            ? "cursor-default border-border bg-background/60 opacity-70"
                            : active
                              ? "border-primary bg-background"
                              : "border-border bg-background hover:bg-accent",
                        )}
                      >
                        {p.adopted
                          ? <CheckCircle2 size={14} className="shrink-0 text-green-500" />
                          : <span className={cn("h-2 w-2 shrink-0 rounded-full", active ? "bg-primary" : "bg-amber-500")} />}
                        <span className="flex flex-col">
                          <span className="font-medium">{p.name ?? "Unnamed patient"}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {p.leadId} · {p.gender ?? "—"} · age {p.age ?? "—"}
                            {!p.isReportAvailable && " · report not ready"}
                          </span>
                        </span>
                        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                          {p.adopted ? "Linked" : active ? "Linking now" : "Link"}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {/* Leads on one order differ by a single digit — the reason the
                    second patient stayed hidden. Say it out loud. */}
                <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                  Their lead IDs look almost identical and their ages differ. Fill each person&apos;s form
                  from their own documents — don&apos;t carry details across.
                </p>
              </div>
            )}

            {multi && !selected && unadopted.length > 0 && (
              <p className="text-xs text-muted-foreground">Pick a person above to link them.</p>
            )}

            {/* Never a dead end: when there's no form, say why. `nothingLeftToDo`
                already has its own banner above, so don't repeat it. */}
            {blockedReason && !nothingLeftToDo && (
              <p className="text-[11px] text-muted-foreground">
                <strong className="text-foreground">No form to fill in:</strong> {blockedReason}
              </p>
            )}

            {!nothingLeftToDo && !blockedReason && (!multi || !!selected) && (
              <>
                {/* The form is open because SOMEONE on this order has a report
                    waiting — that isn't a statement about the person currently
                    selected. On a shared order the roster can mark one person
                    ready and say nothing about the other, and silence is not a
                    yes. Preview still decides; this just stops the open form
                    reading as clearance. */}
                {!pre.reportAvailable && selected && !selected.isReportAvailable && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                    Thyrocare&apos;s list doesn&apos;t confirm a report for{" "}
                    {selected.name ?? "this person"} — it confirmed one for someone else on this order.
                    Preview before you link; it will refuse if there&apos;s nothing to attach.
                  </p>
                )}

                {/* ── Identity form + vendor hint side by side ───────────── */}
                <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
                  <div className="flex flex-col gap-3">
                    {selected ? (
                      <Field
                        label="Lead ID"
                        hint={`Thyrocare's ID for ${selected.name ?? "this patient"} — filled in for you, nothing to type.`}
                      >
                        <div className="rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-sm">
                          {selected.leadId}
                        </div>
                      </Field>
                    ) : (
                      <Field label="Lead ID" required>
                        <Input value={leadId} onChange={(e) => touched(setLeadId)(e.target.value)} className="font-mono text-sm" />
                      </Field>
                    )}
                    <Field label="WhatsApp number" required>
                      <Input value={phone} onChange={(e) => touched(setPhone)(e.target.value)} placeholder="+91 99999 12345" />
                      {/* WhatsApp matches on the country-code form. Show exactly
                          what will be stored — a bare 10-digit number would make
                          a second account she never sees. */}
                      {phone.trim() === "" ? (
                        <p className="text-[11px] text-muted-foreground">
                          This is who receives the result. Include the 91.
                        </p>
                      ) : phoneCheck.ok ? (
                        <p className="text-[11px] text-muted-foreground">
                          Saved as <span className="font-mono text-foreground">{phoneCheck.canonical}</span>
                          {phoneCheck.addedCountryCode && (
                            <span className="text-amber-600 dark:text-amber-400"> — we added the 91 for you</span>
                          )}
                          . WhatsApp must match this exactly, or she gets a second account.
                        </p>
                      ) : (
                        <p className="text-[11px] text-destructive">{phoneCheck.problem}</p>
                      )}
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
                    {/* On a shared order this MUST be the selected person's row,
                        not the order-level hint — otherwise the 24-year-old's
                        details sit beside the 50-year-old's form. */}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {selected ? "About this person only. Compare — don't copy blindly." : "Compare — don't copy blindly."}
                    </p>
                    <dl className="mt-2 space-y-1 text-[11px]">
                      <HintRow k="Name" v={selected?.name ?? hint?.name} />
                      <HintRow k="Age" v={(selected?.age ?? hint?.age) != null ? `${selected?.age ?? hint?.age}` : null} warn />
                      <HintRow k="Gender" v={selected?.gender ?? hint?.gender} />
                      {selected && <HintRow k="Lead" v={selected.leadId} />}
                      <HintRow k="City" v={hint?.city} />
                      <HintRow k="Collected" v={hint?.collectionDate} />
                    </dl>
                    {(selected?.age ?? hint?.age) != null && (
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
function AdoptOutcome({
  result, onClose, onAdoptNext,
}: { result: OrphanAdoptResponse; onClose: () => void; onAdoptNext: (leadId: string) => void }) {
  const deferred = isDeferredNotFailed(result);
  const ok = result.success;
  // Someone else on this order is still waiting for results they paid for. That
  // outranks the success we just had — the job isn't done.
  const remaining = (result.remainingPatients ?? []).filter((p) => !p.adopted);

  return (
    <div className="flex flex-col gap-3">
      {remaining.length > 0 && (ok || deferred) && (
        <Banner tone="warn" icon={<AlertTriangle size={15} />} title="Not finished — someone else on this order has no result">
          <p>
            {remaining.length === 1 ? "This person is" : "These people are"} on the same order and still
            {remaining.length === 1 ? " has" : " have"} no booking:
          </p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {remaining.map((p) => (
              <li key={p.leadId} className="flex items-center gap-2">
                <span className="font-medium text-foreground">{p.name ?? "Unnamed patient"}</span>
                <span className="font-mono text-[10px]">{p.leadId}</span>
                <Button size="sm" variant="outline" className="ml-auto h-6 text-[11px]" onClick={() => onAdoptNext(p.leadId)}>
                  Link them now
                </Button>
              </li>
            ))}
          </ul>
        </Banner>
      )}

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

/**
 * Thyrocare's answer, verbatim. Shown on every failure branch, not just the
 * "no report" one — an operator raising a ticket needs the vendor's own words,
 * and hiding them is how a 500 SERVER_TIMEOUT got summarised as "no such order".
 * `break-all` because the body is one long unbroken JSON string on a phone.
 */
function VendorSaid({ diag }: { diag?: OrphanReportDiagnostic | null }) {
  if (!diag?.vendorBody) return null;
  return (
    <p className="mt-1.5 break-all rounded border border-border/60 bg-background/50 p-1.5 font-mono text-[10px] leading-relaxed">
      {diag.vendorBody}
    </p>
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
