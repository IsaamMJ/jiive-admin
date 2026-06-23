"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { ChevronDown, ChevronUp, X, UserRound } from "lucide-react";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { InfoTip } from "./InfoTip";
import type { PatientDetail, PatientSummary } from "./types";

interface Props {
  /** Currently selected patient id, or null if none. */
  patientId: string | null;
  disabled?: boolean;
  onChange: (id: string | null) => void;
}

/**
 * Filterable patient picker.
 *
 * - Fetches GET /llm-playground/patients once on first open; filters client-side after.
 * - Shows a chip with the selected patient's label when one is active.
 * - On selection also fetches GET /llm-playground/patients/:id to show a compact preview.
 * - Never sends or displays PII — only de-identified label / deidentified fields.
 */
export function PatientPicker({ patientId, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listFetched, setListFetched] = useState(false);

  // Selected patient — we keep the summary for the chip label and the detail for the preview.
  const [selectedSummary, setSelectedSummary] = useState<PatientSummary | null>(null);
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailExpanded, setDetailExpanded] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Fetch list (once, on first open) ─────────────────────────────────────

  const fetchList = useCallback(() => {
    if (listFetched) return;
    setLoadingList(true);
    api
      .get<PatientSummary[]>("/llm-playground/patients")
      .then((r) => {
        setPatients(r.data);
        setListFetched(true);
      })
      .catch(() => {
        // Surface nothing — the panel will just be empty with no error noise.
      })
      .finally(() => setLoadingList(false));
  }, [listFetched]);

  // ── Fetch detail when a patient is selected ───────────────────────────────

  const fetchDetail = useCallback((id: string) => {
    setDetail(null);
    setLoadingDetail(true);
    api
      .get<PatientDetail>(`/llm-playground/patients/${id}`)
      .then((r) => setDetail(r.data))
      .catch(() => { /* silent — preview is bonus; picker still works */ })
      .finally(() => setLoadingDetail(false));
  }, []);

  // ── Open / close ──────────────────────────────────────────────────────────

  const openPanel = () => {
    if (disabled) return;
    setOpen(true);
    fetchList();
    // Focus filter input after paint.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const closePanel = () => {
    setOpen(false);
    setQuery("");
  };

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        closePanel();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { closePanel(); triggerRef.current?.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  // ── Selection ─────────────────────────────────────────────────────────────

  const select = (summary: PatientSummary) => {
    setSelectedSummary(summary);
    setDetailExpanded(false);
    onChange(summary.id);
    closePanel();
    fetchDetail(summary.id);
  };

  const clear = () => {
    setSelectedSummary(null);
    setDetail(null);
    setDetailExpanded(false);
    onChange(null);
  };

  // ── Filtered list ─────────────────────────────────────────────────────────

  const q = query.toLowerCase().trim();
  const filtered = q
    ? patients.filter(
        (p) => p.label.toLowerCase().includes(q) || p.summary.toLowerCase().includes(q),
      )
    : patients;

  // ── Render ────────────────────────────────────────────────────────────────

  const hasPatient = !!patientId && !!selectedSummary;

  return (
    <div className="relative flex flex-col gap-1">
      {/* Trigger row */}
      <div className="flex items-center gap-1.5">
        {hasPatient ? (
          /* Active patient chip */
          <span className="flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
            <UserRound size={11} className="shrink-0" />
            <span className="max-w-[160px] truncate">{selectedSummary.label}</span>
            <button
              type="button"
              aria-label="Clear patient"
              disabled={disabled}
              onClick={clear}
              className="ml-0.5 rounded hover:text-destructive transition-colors disabled:opacity-40"
            >
              <X size={11} />
            </button>
          </span>
        ) : (
          /* Select button */
          <button
            ref={triggerRef}
            type="button"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-label="Select patient"
            disabled={disabled}
            onClick={open ? closePanel : openPanel}
            className={cn(
              "flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              open
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <UserRound size={11} />
            Patient
            {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        )}

        <InfoTip
          label="Loads a real but fully de-identified patient (no name or contact info) so you can ask about their actual results — e.g. 'is this patient's bio-age concerning?'."
          side="top"
        />

        {/* Open/close chip when a patient is already selected */}
        {hasPatient && (
          <button
            ref={triggerRef}
            type="button"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-label="Change patient"
            disabled={disabled}
            onClick={open ? closePanel : openPanel}
            className={cn(
              "flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              open
                ? "border-primary bg-primary/10 text-primary"
                : "border-border hover:bg-accent hover:text-accent-foreground",
            )}
          >
            Change
            {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>
        )}
      </div>

      {/* Dropdown panel */}
      {open && (
        <div
          ref={panelRef}
          role="listbox"
          aria-label="Patient list"
          className={cn(
            "absolute bottom-full left-0 mb-2 z-50",
            "w-72 rounded-lg border border-border bg-popover shadow-lg",
            "flex flex-col overflow-hidden",
          )}
          style={{ maxHeight: "320px" }}
        >
          {/* Filter input */}
          <div className="border-b border-border p-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by label or summary…"
              aria-label="Filter patients"
              className={cn(
                "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs",
                "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
              )}
            />
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loadingList && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">Loading…</p>
            )}
            {!loadingList && filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                {listFetched ? "No patients match." : "No patients loaded."}
              </p>
            )}
            {filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={p.id === patientId}
                onClick={() => select(p)}
                className={cn(
                  "flex w-full flex-col gap-0.5 px-3 py-2 text-left text-xs transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  p.id === patientId && "bg-primary/10 text-primary",
                )}
              >
                <span className="font-medium leading-snug">{p.label}</span>
                {p.summary && (
                  <span className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
                    {p.summary}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* "Patient loaded" preview — shown below the picker when a patient is selected */}
      {hasPatient && (
        <PatientPreview
          detail={detail}
          loading={loadingDetail}
          expanded={detailExpanded}
          onToggle={() => setDetailExpanded((v) => !v)}
        />
      )}
    </div>
  );
}

// ── PatientPreview ────────────────────────────────────────────────────────────

interface PreviewProps {
  detail: PatientDetail | null;
  loading: boolean;
  expanded: boolean;
  onToggle: () => void;
}

function PatientPreview({ detail, loading, expanded, onToggle }: PreviewProps) {
  if (loading) {
    return (
      <p className="text-[11px] text-muted-foreground italic px-0.5">Loading patient…</p>
    );
  }
  if (!detail) return null;

  const { sex, ageBand, latestBioAge, bookings } = detail.deidentified;
  const bookingCount = bookings.length;
  const testTypes = [...new Set(bookings.map((b) => b.testType))].join(", ");

  return (
    <div className="rounded-md border border-border bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">Patient loaded</span>
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse patient detail" : "Expand patient detail"}
          onClick={onToggle}
          className="flex items-center gap-0.5 rounded hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          {expanded ? "Less" : "More"}
        </button>
      </div>

      {/* Compact one-line summary */}
      <p className="mt-1 leading-relaxed">
        {sex} · {ageBand}
        {latestBioAge !== null && latestBioAge !== undefined
          ? ` · bio-age ${latestBioAge}`
          : ""}
        {bookingCount > 0
          ? ` · ${bookingCount} booking${bookingCount !== 1 ? "s" : ""}`
          : ""}
        {testTypes ? ` (${testTypes})` : ""}
      </p>

      {/* Expanded detail — results / biomarkers */}
      {expanded && bookings.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {bookings.map((bk, bi) => (
            <div key={bi} className="rounded border border-border bg-background/60 px-2 py-1.5">
              <p className="font-medium text-foreground">
                {bk.testType}
                <span className="ml-1.5 font-normal text-muted-foreground">({bk.status})</span>
              </p>
              {bk.results.map((res, ri) => (
                <div key={ri} className="mt-1 pl-2 border-l border-border/60">
                  <p>
                    Bio-age {res.calculatedAge}
                    {" · "}
                    chron. band {res.chronologicalAgeBand}
                    {" · "}
                    delta {res.ageDelta}
                    {res.elevatedFlag && (
                      <span className="ml-1 text-amber-600 font-medium">elevated</span>
                    )}
                  </p>
                  {res.biomarkers.length > 0 && (
                    <ul className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                      {res.biomarkers.map((bm, mi) => (
                        <li key={mi}>
                          {bm.name}:{" "}
                          <span className="text-foreground">
                            {bm.value}
                            {bm.unit ? ` ${bm.unit}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
