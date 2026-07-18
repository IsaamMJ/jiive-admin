"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { listBookingsForPicker } from "../api";
import { formatDate } from "../lib/datetime";
import type { PickerBooking } from "../types";

interface Props {
  /** The selected order IDs — the same array the file form sends as `orderIds`. */
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

/** Normalise a typed order id the same way the old free-text field did. */
function normalizeId(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Searchable multi-select over the bookings that carry an order ID. Filters by
 * order id, customer name, or date as you type; tick multiple, selected show as
 * removable chips.
 *
 * Degrades on failure: if the bookings can't be loaded, the search box becomes a
 * plain "type an order ID and press Enter" field so filing is never blocked on a
 * dropdown that wouldn't load. Enter also adds the typed value in the normal case,
 * covering an order that falls outside the fetched window.
 */
export function OrderPicker({ value, onChange, disabled }: Props) {
  const [bookings, setBookings] = useState<PickerBooking[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    listBookingsForPicker()
      .then((b) => {
        if (!alive) return;
        setBookings(b);
        setLoadState("ready");
      })
      .catch(() => {
        if (alive) setLoadState("error");
      });
    return () => {
      alive = false;
    };
  }, []);

  // Click outside closes the dropdown. Only wired while it's open.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selectedSet = useMemo(() => new Set(value), [value]);

  // Look up a selected id's booking for the chip label. A manually typed id that
  // isn't in the fetched window still shows as a bare chip — never dropped.
  const byId = useMemo(() => {
    const m = new Map<string, PickerBooking>();
    for (const b of bookings) m.set(b.orderId, b);
    return m;
  }, [bookings]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows =
      q === ""
        ? bookings
        : bookings.filter(
            (b) =>
              b.orderId.toLowerCase().includes(q) ||
              (b.patientName ?? "").toLowerCase().includes(q) ||
              b.appointmentDate.toLowerCase().includes(q)
          );
    return rows.slice(0, 50); // cap the rendered list — the window can hold 500
  }, [bookings, query]);

  function toggle(orderId: string) {
    if (selectedSet.has(orderId)) onChange(value.filter((id) => id !== orderId));
    else onChange([...value, orderId]);
  }

  function removeChip(orderId: string) {
    onChange(value.filter((id) => id !== orderId));
  }

  function addTyped() {
    const id = normalizeId(query);
    if (!id) return;
    if (!selectedSet.has(id)) onChange([...value, id]);
    setQuery("");
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => {
            const b = byId.get(id);
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 py-1 pl-2.5 pr-1 text-xs text-primary"
              >
                <span className="font-mono font-medium">{id}</span>
                {b?.patientName && <span className="text-primary/70">· {b.patientName}</span>}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeChip(id)}
                  aria-label={`Remove ${id}`}
                  className="inline-flex size-4 items-center justify-center rounded-full text-primary/70 hover:bg-primary/20 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <X size={12} />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTyped();
            }
          }}
          disabled={disabled}
          placeholder={
            loadState === "error"
              ? "Type an order ID and press Enter"
              : "Search order ID, customer, or date"
          }
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="pl-8 font-mono text-base sm:text-sm"
        />

        {open && loadState !== "error" && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-md">
            {loadState === "loading" ? (
              <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                Loading bookings…
              </div>
            ) : results.length === 0 ? (
              <div className="px-3 py-2.5 text-sm text-muted-foreground">
                {query.trim() === "" ? (
                  "No bookings with an order ID in range."
                ) : (
                  <>
                    No match.{" "}
                    <button
                      type="button"
                      onClick={addTyped}
                      className="font-medium text-primary hover:underline"
                    >
                      Add “{normalizeId(query)}” anyway
                    </button>
                  </>
                )}
              </div>
            ) : (
              results.map((b) => {
                const on = selectedSet.has(b.orderId);
                return (
                  <button
                    key={b.bookingId}
                    type="button"
                    onClick={() => toggle(b.orderId)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                      on && "bg-primary/5"
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded border",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-border"
                      )}
                    >
                      {on && <span className="text-[10px] leading-none">✓</span>}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-mono font-medium">{b.orderId}</span>
                      <span className="text-muted-foreground">
                        {" · "}
                        {b.patientName || "—"}
                        {" · "}
                        {formatDate(b.appointmentDate)}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {loadState === "error" ? (
        <span className="text-xs text-muted-foreground">
          Couldn{"'"}t load bookings — type each order ID and press Enter.
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">
          Search and tick the orders this incident is about.
        </span>
      )}
    </div>
  );
}
