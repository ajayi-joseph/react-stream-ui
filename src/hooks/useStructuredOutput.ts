import { useEffect, useRef, useState } from "react";
import type { FinishReason, StreamSource } from "../types.js";
import { parsePartialJSON } from "../parsers/partial-json.js";

export type UseStructuredOutputResult<T> = {
  value: T | undefined;
  raw: string;
  isPartial: boolean;
  isStreaming: boolean;
  finishReason: FinishReason | undefined;
  error: Error | undefined;
};

export function useStructuredOutput<T = unknown>(
  stream: StreamSource | undefined,
  signal?: AbortSignal,
): UseStructuredOutputResult<T> {
  const [state, setState] = useState<UseStructuredOutputResult<T>>(() => ({
    value: undefined,
    raw: "",
    isPartial: true,
    isStreaming: false,
    finishReason: undefined,
    error: undefined,
  }));
  const unmountedRef = useRef(false);

  useEffect(() => {
    if (!stream) return;
    if (signal?.aborted) return;

    unmountedRef.current = false;
    setState({
      value: undefined,
      raw: "",
      isPartial: true,
      isStreaming: true,
      finishReason: undefined,
      error: undefined,
    });

    const iter = stream[Symbol.asyncIterator]();
    let cancelled = false;
    let raw = "";
    let finishReason: FinishReason | undefined;

    const releaseProducer = () => {
      iter.return?.().catch(() => {});
    };

    const onSignalAbort = () => {
      cancelled = true;
      releaseProducer();
    };

    signal?.addEventListener("abort", onSignalAbort);

    (async () => {
      try {
        while (true) {
          const next = await iter.next();
          if (next.done) break;
          if (unmountedRef.current || cancelled) break;

          const chunk = next.value;
          // Treat both text and tool-call deltas as JSON source — whichever the
          // caller pipes in. Capture the terminal finish reason; ignore everything else.
          if (chunk.type === "text-delta") raw += chunk.text;
          else if (chunk.type === "tool-call-delta") raw += chunk.argsDelta;
          else if (chunk.type === "finish") {
            if (chunk.reason === "error") {
              throw new Error(chunk.error ?? "stream errored");
            }
            finishReason = chunk.reason;
            continue;
          } else continue;

          const parsed = parsePartialJSON<T>(raw);
          if (unmountedRef.current) break;
          setState({
            value: parsed.value,
            raw,
            isPartial: parsed.isPartial,
            isStreaming: true,
            finishReason: undefined,
            error: undefined,
          });
        }
        if (!unmountedRef.current) {
          const parsed = parsePartialJSON<T>(raw);
          setState({
            value: parsed.value,
            raw,
            isPartial: parsed.isPartial,
            isStreaming: false,
            finishReason,
            error: undefined,
          });
        }
      } catch (e) {
        if (!unmountedRef.current) {
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            error: e instanceof Error ? e : new Error(String(e)),
          }));
        }
      }
    })();

    return () => {
      unmountedRef.current = true;
      signal?.removeEventListener("abort", onSignalAbort);
      releaseProducer();
    };
  }, [stream, signal]);

  return state;
}
