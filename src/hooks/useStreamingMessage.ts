import { useEffect, useRef, useState } from "react";
import type {
  ContentBlock,
  FinishReason,
  AssistantMessage,
  StreamSource,
  ToolCallBlock,
} from "../types.js";
import { parsePartialJSON } from "../parsers/partial-json.js";

export type UseStreamingMessageResult = {
  message: AssistantMessage;
  isStreaming: boolean;
  finishReason: FinishReason | undefined;
  error: Error | undefined;
};

let messageCounter = 0;

export function useStreamingMessage(
  stream: StreamSource | undefined,
  signal?: AbortSignal,
): UseStreamingMessageResult {
  const [message, setMessage] = useState<AssistantMessage>(() => emptyMessage());
  const [isStreaming, setIsStreaming] = useState(false);
  const [finishReason, setFinishReason] = useState<FinishReason | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const unmountedRef = useRef(false);

  useEffect(() => {
    if (!stream) return;
    if (signal?.aborted) return;

    unmountedRef.current = false;
    setMessage(emptyMessage());
    setError(undefined);
    setFinishReason(undefined);
    setIsStreaming(true);

    const blocks: ContentBlock[] = [];
    const toolIndex = new Map<string, number>();
    const iter = stream[Symbol.asyncIterator]();
    let cancelled = false;

    const releaseProducer = () => {
      iter.return?.().catch(() => {});
    };

    const onSignalAbort = () => {
      cancelled = true;
      releaseProducer();
    };

    signal?.addEventListener("abort", onSignalAbort);

    const commit = () => {
      if (unmountedRef.current) return;
      setMessage((prev) => ({ ...prev, content: blocks.map(cloneBlock) }));
    };

    (async () => {
      try {
        while (true) {
          const next = await iter.next();
          if (next.done) break;
          if (unmountedRef.current || cancelled) break;

          const chunk = next.value;
          switch (chunk.type) {
            case "text-delta":
              appendText(blocks, "text", chunk.text);
              break;
            case "thinking-delta":
              appendText(blocks, "thinking", chunk.text);
              break;
            case "tool-call-start": {
              const block: ToolCallBlock = {
                type: "tool-call",
                id: chunk.id,
                name: chunk.name,
                argsRaw: "",
                args: undefined,
                isPartial: true,
              };
              toolIndex.set(chunk.id, blocks.length);
              blocks.push(block);
              break;
            }
            case "tool-call-delta": {
              const idx = toolIndex.get(chunk.id);
              if (idx === undefined) break;
              const block = blocks[idx] as ToolCallBlock;
              block.argsRaw += chunk.argsDelta;
              const parsed = parsePartialJSON(block.argsRaw);
              block.args = parsed.value;
              block.isPartial = parsed.isPartial;
              break;
            }
            case "tool-call-end": {
              const idx = toolIndex.get(chunk.id);
              if (idx === undefined) break;
              const block = blocks[idx] as ToolCallBlock;
              const parsed = parsePartialJSON(block.argsRaw);
              block.args = parsed.value;
              block.isPartial = false;
              break;
            }
            case "finish":
              if (chunk.reason === "error") {
                throw new Error(chunk.error ?? "stream errored");
              }
              if (!unmountedRef.current) setFinishReason(chunk.reason);
              break;
          }
          commit();
        }
      } catch (e) {
        if (!unmountedRef.current) setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!unmountedRef.current) setIsStreaming(false);
      }
    })();

    return () => {
      unmountedRef.current = true;
      signal?.removeEventListener("abort", onSignalAbort);
      releaseProducer();
    };
  }, [stream, signal]);

  return { message, isStreaming, finishReason, error };
}

function emptyMessage(): AssistantMessage {
  return { id: `msg_${++messageCounter}`, role: "assistant", content: [] };
}

function appendText(blocks: ContentBlock[], type: "text" | "thinking", text: string): void {
  const last = blocks[blocks.length - 1];
  if (last && last.type === type) {
    last.text += text;
    return;
  }
  blocks.push({ type, text } as ContentBlock);
}

function cloneBlock(block: ContentBlock): ContentBlock {
  if (block.type === "tool-call") return { ...block };
  return { ...block };
}
