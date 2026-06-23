"use client";

import { Info } from "lucide-react";
import { Tooltip } from "@base-ui/react/tooltip";

interface Props {
  label: string;
  side?: "top" | "bottom" | "left" | "right";
}

/**
 * Small accessible info icon that shows a plain-language explanation on hover/focus.
 * Uses @base-ui/react Tooltip so the popup is properly positioned (no clipping at edges).
 */
export function InfoTip({ label, side = "top" }: Props) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        // Render as a plain button so keyboard focus works; no visual chrome.
        render={
          <button
            type="button"
            aria-label="More information"
            className="inline-flex items-center justify-center rounded text-muted-foreground/60 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
          />
        }
      >
        <Info size={12} aria-hidden="true" />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side={side} sideOffset={6} collisionPadding={8}>
          <Tooltip.Popup
            className="z-50 max-w-[220px] rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11px] leading-relaxed text-popover-foreground shadow-md"
            role="tooltip"
          >
            {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
