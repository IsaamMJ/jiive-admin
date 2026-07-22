"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SortKey, SortState } from "../lib/sort";

interface Props {
  label: string;
  sortKey: SortKey;
  sort: SortState | null;
  onSort: (key: SortKey) => void;
  /** Right-align for numeric columns so the header sits over its own figures. */
  align?: "left" | "right";
}

/**
 * A column header you can click to sort. The icon carries the whole state:
 *   ↕ (faint, hover only) — sortable, not sorting by this
 *   ↑ / ↓ (solid)         — currently sorting by this, that direction
 *
 * The idle ↕ only appears on hover/focus. Ten permanently-visible arrows turn a
 * header row into noise; the ones doing something stay visible always.
 */
export function SortableHead({ label, sortKey, sort, onSort, align = "left" }: Props) {
  const active = sort?.key === sortKey;
  const dir = active ? sort.dir : null;

  return (
    <TableHead className={cn("p-0", align === "right" && "text-right")}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={
          active
            ? `${label}, sorted ${dir === "asc" ? "ascending" : "descending"}. Activate to ${dir === "asc" ? "sort descending" : "clear sorting"}.`
            : `${label}, not sorted. Activate to sort ascending.`
        }
        // aria-sort belongs on the cell, but the button is what screen readers land
        // on — both are set so either reading order announces the state.
        className={cn(
          "group inline-flex w-full items-center gap-1 px-3 py-2.5 text-left transition-colors",
          "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-sm",
          align === "right" && "justify-end",
          active ? "text-foreground" : "text-muted-foreground"
        )}
      >
        <span className="truncate">{label}</span>
        {dir === "asc" ? (
          <ArrowUp size={12} className="shrink-0" aria-hidden="true" />
        ) : dir === "desc" ? (
          <ArrowDown size={12} className="shrink-0" aria-hidden="true" />
        ) : (
          <ChevronsUpDown
            size={12}
            aria-hidden="true"
            className="shrink-0 opacity-0 transition-opacity group-hover:opacity-50 group-focus-visible:opacity-50"
          />
        )}
      </button>
    </TableHead>
  );
}
