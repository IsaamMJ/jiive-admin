"use client";

import { useRef, useState } from "react";
import { getToken } from "@/lib/auth";
import type {
  ChatRequest,
  SseMetaPayload,
  SseDonePayload,
  SseErrorPayload,
} from "./types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "https://d3pvjhguhk37b0.cloudfront.net/api/v1/admin";

export interface StreamCallbacks {
  onMeta: (payload: SseMetaPayload) => void;
  onToken: (delta: string) => void;
  onDone: (payload: SseDonePayload) => void;
  onError: (payload: SseErrorPayload) => void;
}

export interface UseChatStreamReturn {
  streaming: boolean;
  send: (req: ChatRequest, callbacks: StreamCallbacks) => void;
  stop: () => void;
}

export function useChatStream(): UseChatStreamReturn {
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const stop = () => {
    abortRef.current?.abort();
  };

  const send = (req: ChatRequest, callbacks: StreamCallbacks) => {
    // Abort any in-flight request.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStreaming(true);

    (async () => {
      try {
        const token = getToken();
        const res = await fetch(`${API_BASE}/llm-playground/chat`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(req),
        });

        // Pre-SSE HTTP error (400 / 401 / etc.) — parse JSON body and surface.
        if (!res.ok) {
          let message = `HTTP ${res.status}`;
          try {
            const body = (await res.json()) as { message?: string; error?: string };
            message = body.message ?? body.error ?? message;
          } catch {
            // ignore parse error
          }
          callbacks.onError({ error: "provider_error", message });
          return;
        }

        if (!res.body) {
          callbacks.onError({ error: "provider_error", message: "Empty response body" });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE blocks are delimited by "\n\n".
          const blocks = buffer.split("\n\n");
          // Last element is either empty or a partial block — keep it in the buffer.
          buffer = blocks.pop() ?? "";

          for (const block of blocks) {
            if (!block.trim()) continue;
            const lines = block.split("\n");
            const evLine = lines.find((l) => l.startsWith("event:"));
            const dataLine = lines.find((l) => l.startsWith("data:"));
            if (!evLine || !dataLine) continue;

            const eventName = evLine.slice(6).trim();
            let payload: unknown;
            try {
              payload = JSON.parse(dataLine.slice(5).trim());
            } catch {
              continue;
            }

            switch (eventName) {
              case "meta":
                callbacks.onMeta(payload as SseMetaPayload);
                break;
              case "token":
                callbacks.onToken((payload as { delta: string }).delta ?? "");
                break;
              case "done":
                callbacks.onDone(payload as SseDonePayload);
                break;
              case "error":
                callbacks.onError(payload as SseErrorPayload);
                break;
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // User stopped — not an error.
          return;
        }
        const message =
          err instanceof Error ? err.message : "Unknown streaming error";
        callbacks.onError({ error: "provider_error", message });
      } finally {
        setStreaming(false);
      }
    })();
  };

  return { streaming, send, stop };
}
