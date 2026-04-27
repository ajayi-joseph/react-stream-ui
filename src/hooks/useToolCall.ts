import { useMemo } from "react";
import type { Message, ToolCallBlock } from "../types.js";

export function useToolCall(message: Message, id: string): ToolCallBlock | undefined {
  return useMemo(() => {
    for (const block of message.content) {
      if (block.type === "tool-call" && block.id === id) return block;
    }
    return undefined;
  }, [message, id]);
}
