export type FinishReason = "stop" | "length" | "tool_use";

export type StreamChunk =
  | { type: "text-delta"; text: string }
  | { type: "thinking-delta"; text: string }
  | { type: "tool-call-start"; id: string; name: string }
  | { type: "tool-call-delta"; id: string; argsDelta: string }
  | { type: "tool-call-end"; id: string }
  | { type: "finish"; reason: FinishReason | "error"; error?: string };

export type TextBlock = { type: "text"; text: string };
export type ThinkingBlock = { type: "thinking"; text: string };
export type ToolCallBlock = {
  type: "tool-call";
  id: string;
  name: string;
  argsRaw: string;
  args: unknown;
  isPartial: boolean;
};

export type ContentBlock = TextBlock | ThinkingBlock | ToolCallBlock;

export type Message = {
  id: string;
  role: "assistant";
  content: ContentBlock[];
};

export type StreamSource = AsyncIterable<StreamChunk>;
