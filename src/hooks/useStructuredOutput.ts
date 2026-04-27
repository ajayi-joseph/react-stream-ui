import { useEffect, useRef, useState } from "react";
import type { StreamSource } from "../types.js";
import { parsePartialJSON } from "../parsers/partial-json.js";

export type UseStructuredOutputResult<T> = {
  value: T | undefined;
  raw: string;
  isPartial: boolean;
  isStreaming: boolean;
  error: Error | undefined;
};

export function useStructuredOutput<T = unknown>(
  stream: StreamSource | undefined,
): UseStructuredOutputResult<T> {
  const [state, setState] = useState<UseStructuredOutputResult<T>>(() => ({
    value: undefined,
    raw: "",
    isPartial: true,
    isStreaming: false,
    error: undefined,
  }));
  const abortRef = useRef(false);

  useEffect(() => {
    if (!stream) return;
    abortRef.current = false;
    setState({ value: undefined, raw: "", isPartial: true, isStreaming: true, error: undefined });

    let raw = "";

    (async () => {
      try {
        for await (const chunk of stream) {
          if (abortRef.current) return;

          // Treat both text and tool-call deltas as JSON source — whichever the
          // caller pipes in. Ignore everything else.
          if (chunk.type === "text-delta") raw += chunk.text;
          else if (chunk.type === "tool-call-delta") raw += chunk.argsDelta;
          else if (chunk.type === "finish" && chunk.reason === "error" && chunk.error) {
            throw new Error(chunk.error);
          } else continue;

          const parsed = parsePartialJSON<T>(raw);
          setState({
            value: parsed.value,
            raw,
            isPartial: parsed.isPartial,
            isStreaming: true,
            error: undefined,
          });
        }
        if (!abortRef.current) {
          const parsed = parsePartialJSON<T>(raw);
          setState({
            value: parsed.value,
            raw,
            isPartial: parsed.isPartial,
            isStreaming: false,
            error: undefined,
          });
        }
      } catch (e) {
        if (!abortRef.current) {
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            error: e instanceof Error ? e : new Error(String(e)),
          }));
        }
      }
    })();

    return () => {
      abortRef.current = true;
    };
  }, [stream]);

  return state;
}
