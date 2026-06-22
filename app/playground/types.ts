// ── Contract types for /llm-playground endpoints ─────────────────────────────

export type LlmModel = "aws" | "hf";

// POST /llm-playground/chat ───────────────────────────────────────────────────

export interface ChatRequest {
  prompt: string;
  model: LlmModel;
  useRag: boolean;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

// SSE event payloads (in arrival order: meta → token* → done | error) ─────────

export interface RagSource {
  title: string;
  snippet: string;
}

export interface SseMetaPayload {
  model: LlmModel;
  ragSources?: RagSource[] | null;
}

export interface SseTokenPayload {
  delta: string;
}

export interface SseDonePayload {
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
}

export interface SseErrorPayload {
  error: "aws_offline" | "hf_not_configured" | "provider_error" | string;
  message: string;
}

// GET /llm-playground/status ──────────────────────────────────────────────────

export type AwsState =
  | "running"
  | "stopped"
  | "pending"
  | "stopping"
  | "unconfigured"
  | "permission_denied"
  | "error";

export interface AwsStatus {
  running: boolean;
  state: AwsState;
  instanceId?: string;
}

export interface HfStatus {
  configured: boolean;
  endpointUrl?: string;
}

export interface PlaygroundStatus {
  aws: AwsStatus;
  hf: HfStatus;
}

// POST /llm-playground/box ────────────────────────────────────────────────────

export type BoxAction = "start" | "stop";

export interface BoxRequest {
  action: BoxAction;
}

export interface BoxResponse {
  previousState: AwsState;
  currentState: AwsState;
  instanceId?: string;
}

// Transcript ──────────────────────────────────────────────────────────────────

export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  model?: LlmModel;
  ragSources?: RagSource[] | null;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  error?: string; // error code or message
}

// Helpers ─────────────────────────────────────────────────────────────────────

export interface StatePill {
  label: string;
  colorClass: string; // tailwind bg + text classes
}

/** Map aws.state → display pill. */
export function awsStatePill(state: AwsState): StatePill {
  switch (state) {
    case "running":
      return { label: "Running", colorClass: "bg-green-500/10 text-green-600 border-green-300" };
    case "stopped":
      return { label: "Offline", colorClass: "bg-red-500/10 text-red-600 border-red-300" };
    case "pending":
      return { label: "Starting…", colorClass: "bg-yellow-400/10 text-yellow-700 border-yellow-300" };
    case "stopping":
      return { label: "Stopping…", colorClass: "bg-yellow-400/10 text-yellow-700 border-yellow-300" };
    case "permission_denied":
      return { label: "IAM not set", colorClass: "bg-muted text-muted-foreground border-border" };
    case "unconfigured":
      return { label: "Not configured", colorClass: "bg-muted text-muted-foreground border-border" };
    case "error":
      return { label: "Error", colorClass: "bg-red-500/10 text-red-600 border-red-300" };
  }
}

/** True while the box is in a transitioning state that needs polling to resolve. */
export function isTransitioning(state: AwsState): boolean {
  return state === "pending" || state === "stopping";
}
