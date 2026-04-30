import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useStreamingMessage } from "../hooks/useStreamingMessage.js";
import { makeControlledStream, makeStream } from "./helpers.js";

describe("useStreamingMessage — accumulation", () => {
  it("collapses consecutive text deltas into one block", async () => {
    const stream = makeStream([
      { type: "text-delta", text: "hello " },
      { type: "text-delta", text: "world" },
      { type: "finish", reason: "stop" },
    ]);
    const { result } = renderHook(() => useStreamingMessage(stream));

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.message.content).toEqual([{ type: "text", text: "hello world" }]);
    expect(result.current.finishReason).toBe("stop");
    expect(result.current.error).toBeUndefined();
  });

  it("keeps text and thinking blocks separate, in order", async () => {
    const stream = makeStream([
      { type: "thinking-delta", text: "let me check" },
      { type: "text-delta", text: "result" },
      { type: "finish", reason: "stop" },
    ]);
    const { result } = renderHook(() => useStreamingMessage(stream));

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.message.content).toEqual([
      { type: "thinking", text: "let me check" },
      { type: "text", text: "result" },
    ]);
  });

  it("builds a tool-call block from streamed JSON args", async () => {
    const stream = makeStream([
      { type: "tool-call-start", id: "c1", name: "lookup" },
      { type: "tool-call-delta", id: "c1", argsDelta: '{"q":"' },
      { type: "tool-call-delta", id: "c1", argsDelta: 'hi"}' },
      { type: "tool-call-end", id: "c1" },
      { type: "finish", reason: "tool_use" },
    ]);
    const { result } = renderHook(() => useStreamingMessage(stream));

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    const [block] = result.current.message.content;
    expect(block).toMatchObject({
      type: "tool-call",
      id: "c1",
      name: "lookup",
      args: { q: "hi" },
      isPartial: false,
    });
    expect(result.current.finishReason).toBe("tool_use");
  });

  it("captures finishReason=length when the model is truncated", async () => {
    const stream = makeStream([
      { type: "text-delta", text: "this got cut off" },
      { type: "finish", reason: "length" },
    ]);
    const { result } = renderHook(() => useStreamingMessage(stream));

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.finishReason).toBe("length");
    expect(result.current.error).toBeUndefined();
  });

  it("ignores tool-call deltas that arrive before the matching start", async () => {
    const stream = makeStream([
      { type: "tool-call-delta", id: "ghost", argsDelta: "{}" },
      { type: "text-delta", text: "ok" },
      { type: "finish", reason: "stop" },
    ]);
    const { result } = renderHook(() => useStreamingMessage(stream));

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.message.content).toEqual([{ type: "text", text: "ok" }]);
  });
});

describe("useStreamingMessage — errors", () => {
  it("surfaces a finish-error as a thrown Error", async () => {
    const stream = makeStream([
      { type: "text-delta", text: "starting" },
      { type: "finish", reason: "error", error: "rate limited" },
    ]);
    const { result } = renderHook(() => useStreamingMessage(stream));

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.error?.message).toBe("rate limited");
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.finishReason).toBeUndefined();
  });
});

describe("useStreamingMessage — cancellation", () => {
  it("calls iterator.return() when the component unmounts", async () => {
    const ctl = makeControlledStream();
    const { result, unmount } = renderHook(() => useStreamingMessage(ctl.stream));

    act(() => ctl.push({ type: "text-delta", text: "hi" }));
    await waitFor(() => expect(result.current.message.content.length).toBe(1));

    unmount();
    await waitFor(() => expect(ctl.returnCalled()).toBe(true));
  });

  it("calls iterator.return() and stops streaming when the signal aborts", async () => {
    const ctl = makeControlledStream();
    const ac = new AbortController();
    const { result } = renderHook(() => useStreamingMessage(ctl.stream, ac.signal));

    act(() => ctl.push({ type: "text-delta", text: "hi" }));
    await waitFor(() => expect(result.current.message.content.length).toBe(1));

    act(() => ac.abort());
    await waitFor(() => expect(ctl.returnCalled()).toBe(true));
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
  });

  it("does not start when the signal is already aborted", async () => {
    const ctl = makeControlledStream();
    const ac = new AbortController();
    ac.abort();
    const { result } = renderHook(() => useStreamingMessage(ctl.stream, ac.signal));

    expect(result.current.isStreaming).toBe(false);
    expect(ctl.returnCalled()).toBe(false);
  });
});
