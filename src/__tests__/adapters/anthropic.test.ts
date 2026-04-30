import { describe, expect, it } from "vitest";
import type { RawMessageStreamEvent } from "@anthropic-ai/sdk/resources/messages";
import { fromAnthropicStream } from "../../../examples/adapters/anthropic.js";
import type { StreamChunk } from "../../index.js";

async function* fromArray<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of stream) out.push(c);
  return out;
}

// The SDK event types are large unions with many required fields; the adapter
// only touches a handful, so tests construct minimal shapes and cast through
// `unknown`.
function events(...items: unknown[]): RawMessageStreamEvent[] {
  return items as RawMessageStreamEvent[];
}

describe("fromAnthropicStream — text", () => {
  it("yields a text-delta per text_delta event", async () => {
    const out = await collect(
      fromAnthropicStream(
        fromArray(
          events(
            { type: "message_start", message: {} },
            {
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "" },
            },
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "hello " },
            },
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "world" },
            },
            { type: "content_block_stop", index: 0 },
            { type: "message_delta", delta: { stop_reason: "end_turn" } },
            { type: "message_stop" },
          ),
        ),
      ),
    );
    expect(out).toEqual([
      { type: "text-delta", text: "hello " },
      { type: "text-delta", text: "world" },
      { type: "finish", reason: "stop" },
    ]);
  });
});

describe("fromAnthropicStream — thinking", () => {
  it("maps thinking_delta to thinking-delta and ignores signature_delta", async () => {
    const out = await collect(
      fromAnthropicStream(
        fromArray(
          events(
            {
              type: "content_block_start",
              index: 0,
              content_block: { type: "thinking", thinking: "" },
            },
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "thinking_delta", thinking: "let me check" },
            },
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "signature_delta", signature: "abc" },
            },
            { type: "content_block_stop", index: 0 },
            { type: "message_delta", delta: { stop_reason: "end_turn" } },
            { type: "message_stop" },
          ),
        ),
      ),
    );
    expect(out).toEqual([
      { type: "thinking-delta", text: "let me check" },
      { type: "finish", reason: "stop" },
    ]);
  });
});

describe("fromAnthropicStream — tool calls", () => {
  it("emits start, deltas, end, and finish=tool_use", async () => {
    const out = await collect(
      fromAnthropicStream(
        fromArray(
          events(
            {
              type: "content_block_start",
              index: 0,
              content_block: { type: "tool_use", id: "tu_1", name: "lookup", input: {} },
            },
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "input_json_delta", partial_json: '{"q":' },
            },
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "input_json_delta", partial_json: '"hi"}' },
            },
            { type: "content_block_stop", index: 0 },
            { type: "message_delta", delta: { stop_reason: "tool_use" } },
            { type: "message_stop" },
          ),
        ),
      ),
    );
    expect(out).toEqual([
      { type: "tool-call-start", id: "tu_1", name: "lookup" },
      { type: "tool-call-delta", id: "tu_1", argsDelta: '{"q":' },
      { type: "tool-call-delta", id: "tu_1", argsDelta: '"hi"}' },
      { type: "tool-call-end", id: "tu_1" },
      { type: "finish", reason: "tool_use" },
    ]);
  });

  it("routes input_json_delta by content-block index when blocks interleave", async () => {
    const out = await collect(
      fromAnthropicStream(
        fromArray(
          events(
            {
              type: "content_block_start",
              index: 0,
              content_block: { type: "tool_use", id: "a", name: "f", input: {} },
            },
            {
              type: "content_block_start",
              index: 1,
              content_block: { type: "tool_use", id: "b", name: "g", input: {} },
            },
            {
              type: "content_block_delta",
              index: 1,
              delta: { type: "input_json_delta", partial_json: "[" },
            },
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "input_json_delta", partial_json: "{" },
            },
            { type: "content_block_stop", index: 0 },
            { type: "content_block_stop", index: 1 },
            { type: "message_delta", delta: { stop_reason: "tool_use" } },
            { type: "message_stop" },
          ),
        ),
      ),
    );
    expect(out).toEqual([
      { type: "tool-call-start", id: "a", name: "f" },
      { type: "tool-call-start", id: "b", name: "g" },
      { type: "tool-call-delta", id: "b", argsDelta: "[" },
      { type: "tool-call-delta", id: "a", argsDelta: "{" },
      { type: "tool-call-end", id: "a" },
      { type: "tool-call-end", id: "b" },
      { type: "finish", reason: "tool_use" },
    ]);
  });

  it("ignores content_block_stop for non-tool blocks", async () => {
    const out = await collect(
      fromAnthropicStream(
        fromArray(
          events(
            {
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "" },
            },
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "hi" },
            },
            { type: "content_block_stop", index: 0 },
            { type: "message_delta", delta: { stop_reason: "end_turn" } },
            { type: "message_stop" },
          ),
        ),
      ),
    );
    expect(out).toEqual([
      { type: "text-delta", text: "hi" },
      { type: "finish", reason: "stop" },
    ]);
  });
});

describe("fromAnthropicStream — finish reasons", () => {
  it("maps max_tokens to length", async () => {
    const out = await collect(
      fromAnthropicStream(
        fromArray(
          events(
            { type: "message_delta", delta: { stop_reason: "max_tokens" } },
            { type: "message_stop" },
          ),
        ),
      ),
    );
    expect(out).toEqual([{ type: "finish", reason: "length" }]);
  });

  it("maps stop_sequence to stop", async () => {
    const out = await collect(
      fromAnthropicStream(
        fromArray(
          events(
            { type: "message_delta", delta: { stop_reason: "stop_sequence" } },
            { type: "message_stop" },
          ),
        ),
      ),
    );
    expect(out).toEqual([{ type: "finish", reason: "stop" }]);
  });

  it("treats a missing stop_reason as stop", async () => {
    const out = await collect(
      fromAnthropicStream(fromArray(events({ type: "message_stop" }))),
    );
    expect(out).toEqual([{ type: "finish", reason: "stop" }]);
  });
});
