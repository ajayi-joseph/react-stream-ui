import { useEffect, useRef, useState } from "react";
import type { ContentBlock, Message, StreamSource, ToolCallBlock } from "../types.js";
import { parsePartialJSON } from "../parsers/partial-json.js";

export type UseStreamingMessageResult = {
  message: Message;
  isStreaming: boolean;
  error: Error | undefined;
};

let messageCounter = 0;

export function useStreamingMessage(stream: StreamSource | undefined): UseStreamingMessageResult {
  const [message, setMessage] = useState<Message>(() => emptyMessage());
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const abortRef = useRef(false);

  useEffect(() => {
    if (!stream) return;
    abortRef.current = false;
    setMessage(emptyMessage());
    setError(undefined);
    setIsStreaming(true);

    const blocks: ContentBlock[] = [];
    const toolIndex = new Map<string, number>();

    const commit = () => {
      if (abortRef.current) return;
      setMessage((prev) => ({ ...prev, content: blocks.map(cloneBlock) }));
    };

    (async () => {
      try {
        for await (const chunk of stream) {
          if (abortRef.current) return;

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
              if (chunk.reason === "error" && chunk.error) {
                throw new Error(chunk.error);
              }
              break;
          }
          commit();
        }
      } catch (e) {
        if (!abortRef.current) setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!abortRef.current) setIsStreaming(false);
      }
    })();

    return () => {
      abortRef.current = true;
    };
  }, [stream]);

  return { message, isStreaming, error };
}

function emptyMessage(): Message {
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
