"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import api from "@/lib/api";
import type { AwsState, AwsStatus, BoxResponse } from "./types";
import { awsStatePill, isTransitioning } from "./types";

interface Props {
  aws: AwsStatus;
  onActionDone: () => void; // tells parent to kick off status polling
}

export function AwsBoxControl({ aws, onActionDone }: Props) {
  const [busy, setBusy] = useState(false);

  const pill = awsStatePill(aws.state);
  const transitioning = isTransitioning(aws.state) || busy;

  const doAction = async (action: "start" | "stop") => {
    setBusy(true);
    try {
      await api.post<BoxResponse>("/llm-playground/box", { action });
      onActionDone();
    } catch (err: unknown) {
      const resp = (err as { response?: { data?: { error?: string; message?: string } } })
        ?.response?.data;
      const errorCode = resp?.error;
      if (errorCode === "iam_permission_missing") {
        toast.error("IAM policy not configured. Contact ops.");
      } else if (errorCode === "aws_not_configured") {
        toast.error("AWS instance not configured. Contact ops.");
      } else {
        toast.error(resp?.message ?? `Box ${action} failed`);
      }
    } finally {
      setBusy(false);
    }
  };

  const renderButton = (state: AwsState) => {
    if (state === "unconfigured") return null;
    if (state === "permission_denied" || state === "error") {
      return (
        <Button size="sm" variant="outline" disabled title={
          state === "permission_denied" ? "Ops must add IAM policy" : "Box is in error state"
        }>
          {state === "permission_denied" ? "Start box" : "Unavailable"}
        </Button>
      );
    }
    if (transitioning) {
      return (
        <Button size="sm" variant="outline" disabled>
          <Loader2 size={13} className="animate-spin" />
          {state === "pending" || busy ? "Starting…" : "Stopping…"}
        </Button>
      );
    }
    if (state === "running") {
      return (
        <Button size="sm" variant="outline" onClick={() => doAction("stop")}>
          Stop box
        </Button>
      );
    }
    // stopped
    return (
      <Button size="sm" variant="outline" onClick={() => doAction("start")}>
        Start box
        <span className="ml-1 text-[10px] text-muted-foreground">(~2-3 min)</span>
      </Button>
    );
  };

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
          pill.colorClass,
        )}
      >
        {transitioning && (aws.state === "pending" || aws.state === "stopping") && (
          <Loader2 size={10} className="animate-spin mr-1" />
        )}
        {pill.label}
      </span>
      {renderButton(aws.state)}
    </div>
  );
}
