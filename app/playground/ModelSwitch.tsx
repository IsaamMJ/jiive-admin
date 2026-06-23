"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LlmModel, AwsState, HfStatus } from "./types";
import { InfoTip } from "./InfoTip";

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

  const btn = (value: LlmModel, label: string, itemDisabled: boolean, unavailReason: string) => {
    const active = model === value;
    const showOff = itemDisabled && !active && !disabled;
    return (
      <button
        key={value}
        type="button"
        role="radio"
        aria-checked={active}
        aria-label={`${label} model${active ? " (selected)" : ""}`}
        disabled={itemDisabled}
        title={showOff ? unavailReason : undefined}
        onClick={() => { if (!itemDisabled) onChange(value); }}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
          "disabled:cursor-not-allowed",
          active
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40",
        )}
      >
        {active && <Check size={13} className="shrink-0" />}
        {label}
        {showOff && <span className="text-[10px] opacity-70">(off)</span>}
      </button>
    );
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">Model</span>
      <InfoTip
        label="Both options run the same medical AI (MedGemma) — AWS is the dedicated server, HuggingFace is a hosted backup. Answers should be similar."
        side="bottom"
      />
      <div
        role="radiogroup"
        aria-label="Model"
        className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5"
      >
        {btn("hf", "HuggingFace", hfDisabled, "HuggingFace endpoint not configured")}
        {btn("aws", "AWS MedGemma", awsDisabled, "AWS instance not configured")}
      </div>
    </div>
  );
}
