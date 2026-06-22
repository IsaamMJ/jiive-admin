"use client";

import { cn } from "@/lib/utils";
import type { LlmModel, AwsState, HfStatus } from "./types";

interface Props {
  model: LlmModel;
  awsState: AwsState;
  hf: HfStatus;
  disabled?: boolean;
  onChange: (m: LlmModel) => void;
}

export function ModelSwitch({ model, awsState, hf, disabled, onChange }: Props) {
  const hfDisabled = disabled || !hf.configured;
  const awsDisabled = disabled || awsState === "unconfigured";

  const btn = (value: LlmModel, label: string, itemDisabled: boolean) => {
    const active = model === value;
    return (
      <button
        key={value}
        type="button"
        aria-pressed={active}
        aria-label={`Switch to ${label} model`}
        disabled={itemDisabled}
        onClick={() => { if (!itemDisabled) onChange(value); }}
        className={cn(
          "px-3 py-1 text-xs font-medium rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
          active
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-background text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground",
        )}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
      {btn("hf", "HF", hfDisabled)}
      {btn("aws", "AWS MedGemma", awsDisabled)}
    </div>
  );
}
