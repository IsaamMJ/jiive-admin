"use client";

/**
 * "What this review could not check" — ONE amber panel for every check that
 * didn't run.
 *
 * WHY MERGED. Before this, `conflictGate: "inert"` had its own amber card,
 * duplicated verbatim in both review modes. Adding chunk-preview-absent as a
 * second card would put two near-identical amber panels on every document a
 * weaker backend serves — which is precisely how you teach an operator to
 * dismiss amber. The panel count goes 2 → 1 even as a new gap is added.
 *
 * WHAT DOES NOT BELONG HERE:
 * • `digitalNative === null` — a property of the source document, not a check,
 *   and already stated in the dialog header meta line. Duplicating it is noise.
 * • unknown `sourceDate` — an input the operator can fix, so it lives in
 *   SourceDateField where they can act on it, not in a list of things they must
 *   absorb.
 *
 * It informs and never blocks. A capability gap is not the operator's fault and
 * cannot be cleared by them; blocking on it would make approval impossible on
 * any deployment missing the check, and a gate that can't be satisfied is a
 * gate someone removes.
 */

import { AlertTriangle } from "lucide-react";
import { NOT_CHECKED_INTRO } from "./chunkPreview";

export interface NotCheckedItem {
  /** Short name of the check, e.g. "Numeric conflicts". */
  name: string;
  /** What its silence actually means — never a paraphrase that softens it. */
  meaning: string;
}

export function NotCheckedPanel({ items }: { items: NotCheckedItem[] }) {
  // No items means every check ran. Rendering an empty panel would be its own
  // small false assurance, so the component simply isn't there.
  if (items.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
      <p className="flex items-start gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        {items.length} check{items.length !== 1 ? "s" : ""} did not run on this document
      </p>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.name} className="text-[11px] leading-relaxed text-muted-foreground">
            <strong className="text-foreground">{item.name}</strong> — {item.meaning}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
        {NOT_CHECKED_INTRO}
      </p>
    </div>
  );
}
