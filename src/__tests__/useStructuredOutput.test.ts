import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useStructuredOutput } from "../hooks/useStructuredOutput.js";
import { makeControlledStream, makeStream } from "./helpers.js";

describe("useStructuredOutput — accumulation", () => {
  it("parses a complete object from text deltas", async () => {
    const stream = makeStream([
      { type: "text-delta", text: '{"items":["a",' },
      { type: "text-delta", text: '"b"]}' },
      { type: "finish", reason: "stop" },
    ]);
    const { result } = renderHook(() => useStructuredOutput<{ items: string[] }>(stream));

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.value).toEqual({ items: ["a", "b"] });
    expect(result.current.isPartial).toBe(false);
    expect(result.current.finishReason).toBe("stop");
    expect(result.current.error).toBeUndefined();
  });

  it("parses a complete object from tool-call deltas", async () => {
    const stream = makeStream([
      { type: "tool-call-start", id: "c1", name: "x" },
      { type: "tool-call-delta", id: "c1", argsDelta: '{"n":1' },
      { type: "tool-call-delta", id: "c1", argsDelta: "}" },
      { type: "tool-call-end", id: "c1" },
      { type: "finish", reason: "tool_use" },
    ]);
    const { result } = renderHook(() => useStructuredOutput<{ n: number }>(stream));

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.value).toEqual({ n: 1 });
    expect(result.current.isPartial).toBe(false);
    expect(result.current.finishReason).toBe("tool_use");
  });

  it("captures finishReason=length when truncation cuts off the JSON", async () => {
    const stream = makeStream([
      { type: "text-delta", text: '{"a":1,"b":2' },
      { type: "finish", reason: "length" },
    ]);
    const { result } = renderHook(() => useStructuredOutput<{ a: number; b: number }>(stream));

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.value).toEqual({ a: 1, b: 2 });
    expect(result.current.isPartial).toBe(true);
    expect(result.current.finishReason).toBe("length");
  });

  it("exposes a partial value mid-stream and finalizes when closed", async () => {
    const ctl = makeControlledStream();
    const { result } = renderHook(() =>
      useStructuredOutput<{ a: number; b: string }>(ctl.stream),
    );

    act(() => ctl.push({ type: "text-delta", text: '{"a":1,"b":"hel' }));
    await waitFor(() => {
      expect(result.current.value).toMatchObject({ a: 1, b: "hel" });
      expect(result.current.isPartial).toBe(true);
    });

    act(() => ctl.push({ type: "text-delta", text: 'lo"}' }));
    act(() => ctl.close());
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.value).toEqual({ a: 1, b: "hello" });
    expect(result.current.isPartial).toBe(false);
  });
});

describe("useStructuredOutput — errors", () => {
  it("surfaces a finish-error as a thrown Error", async () => {
    const stream = makeStream([
      { type: "text-delta", text: "{" },
      { type: "finish", reason: "error", error: "boom" },
    ]);
    const { result } = renderHook(() => useStructuredOutput(stream));

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.error?.message).toBe("boom");
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.finishReason).toBeUndefined();
  });
});

describe("useStructuredOutput — cancellation", () => {
  it("calls iterator.return() when the component unmounts", async () => {
    const ctl = makeControlledStream();
    const { result, unmount } = renderHook(() => useStructuredOutput(ctl.stream));

    act(() => ctl.push({ type: "text-delta", text: '{"x":1' }));
    await waitFor(() => expect(result.current.value).toEqual({ x: 1 }));

    unmount();
    await waitFor(() => expect(ctl.returnCalled()).toBe(true));
  });

  it("calls iterator.return() and stops streaming when the signal aborts", async () => {
    const ctl = makeControlledStream();
    const ac = new AbortController();
    const { result } = renderHook(() => useStructuredOutput(ctl.stream, ac.signal));

    act(() => ctl.push({ type: "text-delta", text: '{"x":1' }));
    await waitFor(() => expect(result.current.value).toEqual({ x: 1 }));

    act(() => ac.abort());
    await waitFor(() => expect(ctl.returnCalled()).toBe(true));
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
  });
});
