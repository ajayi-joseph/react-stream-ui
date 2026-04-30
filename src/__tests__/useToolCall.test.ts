import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useToolCall } from "../hooks/useToolCall.js";
import type { AssistantMessage } from "../types.js";

const message: AssistantMessage = {
  id: "m1",
  role: "assistant",
  content: [
    { type: "text", text: "hi" },
    {
      type: "tool-call",
      id: "c1",
      name: "lookup",
      argsRaw: '{"q":"x"}',
      args: { q: "x" },
      isPartial: false,
    },
    {
      type: "tool-call",
      id: "c2",
      name: "search",
      argsRaw: '{"k":1}',
      args: { k: 1 },
      isPartial: false,
    },
  ],
};

describe("useToolCall", () => {
  it("returns the tool call with the matching id", () => {
    const { result } = renderHook(() => useToolCall(message, "c2"));
    expect(result.current).toMatchObject({ id: "c2", name: "search", args: { k: 1 } });
  });

  it("returns undefined when no tool call matches", () => {
    const { result } = renderHook(() => useToolCall(message, "missing"));
    expect(result.current).toBeUndefined();
  });

  it("returns undefined when the message has no tool-call blocks", () => {
    const m: AssistantMessage = {
      id: "m2",
      role: "assistant",
      content: [{ type: "text", text: "no tools here" }],
    };
    const { result } = renderHook(() => useToolCall(m, "c1"));
    expect(result.current).toBeUndefined();
  });
});
