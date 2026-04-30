import { useMemo } from "react";
import type { AssistantMessage, ToolCallBlock } from "../types.js";

export function useToolCall(message: AssistantMessage, id: string): ToolCallBlock | undefined {
  return useMemo(() => {
    for (const block of message.content) {
      if (block.type === "tool-call" && block.id === id) return block;
    }
    return undefined;
  }, [message, id]);
}
